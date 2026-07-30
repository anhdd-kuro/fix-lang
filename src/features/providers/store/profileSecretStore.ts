/**
 * @file profileSecretStore.ts
 * @description Profile-scoped, safeStorage-backed provider secrets.
 *
 * Secrets remain in the main process and are stored only as OS-encrypted
 * ciphertext. File names contain a validated profile id and provider, never a
 * secret value.
 */
import { rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import { findKeyShapeMismatch } from "~/features/providers/shared/providerKeyShapes";
import {
  PROVIDER_IDS,
  PROVIDER_LOG_LABELS,
  PROVIDER_SUPPORTS_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
} from "~/features/providers/shared/providers";
import type { ProviderId } from "~/features/providers/store/apiStore";

export type SecretKind = "api" | "provisioning" | "secret";

export type SecretWriteResult = {
  success: boolean;
  error?: string;
};

const isValidProfileId = (profileId: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(profileId);

/**
 * Derived from the provider tables, never hand-written per provider: a provider
 * with no listed slots reads as "nothing to clear", so profile deletion would
 * leave its key on disk.
 */
export const secretKindsForProvider = (provider: ProviderId): SecretKind[] => [
  ...(PROVIDER_SUPPORTS_API_KEY[provider] ? (["api"] as const) : []),
  ...(provider === "bedrock" ? (["secret"] as const) : []),
  ...(PROVIDER_SUPPORTS_PROVISIONING_KEY[provider] ? (["provisioning"] as const) : []),
];

const provisioningProviderNames = (): string =>
  PROVIDER_IDS.filter((provider) => PROVIDER_SUPPORTS_PROVISIONING_KEY[provider])
    .map((provider) => PROVIDER_LOG_LABELS[provider])
    .join(" and ");

const invalidSecretTarget = (): SecretWriteResult => ({
  success: false,
  error: "Invalid profile or provider",
});

/**
 * Deterministic encrypted-secret path for a profile/provider pair. The throws are
 * unreachable programmer-error diagnostics, hence log labels rather than i18n.
 */
export const getProfileSecretPath = (
  profileId: string,
  provider: ProviderId,
  kind: SecretKind,
): string => {
  if (!isValidProfileId(profileId)) {
    throw new Error("Invalid profile id");
  }
  if (!secretKindsForProvider(provider).includes(kind)) {
    throw new Error(
      kind === "api"
        ? `${PROVIDER_LOG_LABELS[provider]} does not use an API key`
        : `Only ${provisioningProviderNames()} use an admin key`,
    );
  }

  return path.join(
    app.getPath("userData"),
    `${provider}-${kind}-key.${profileId}.enc`,
  );
};

/**
 * Rejects empty input, and a key whose prefix positively identifies ANOTHER
 * provider's slot. The latter used to be accepted on purpose; it turned out to
 * have a consumer after all — an `sk-admin-…` OpenAI key written into
 * OpenRouter's provisioning slot stored fine, showed "Key set" (existence is all
 * `hasProfileSecret` can see), and surfaced only as a 401 on every later account
 * read. An unrecognized format is still accepted, so no legacy or future key
 * shape is refused on a guess.
 */
const validateSecret = (
  provider: ProviderId,
  kind: SecretKind,
  raw: string,
): { value: string } | { error: string } => {
  const value = raw.trim();
  if (!value) return { error: "API key must not be empty" };
  const mismatch = findKeyShapeMismatch(provider, kind, value);
  if (mismatch) {
    return {
      error: `That key does not belong to ${PROVIDER_LOG_LABELS[provider]}'s ${
        kind === "provisioning" ? "admin" : kind === "secret" ? "secret" : "API"
      } key (expected ${mismatch.expectedPrefix}…)`,
    };
  }
  return { value };
};

export const setProfileSecret = async (
  profileId: string,
  provider: ProviderId,
  kind: SecretKind,
  raw: string,
): Promise<SecretWriteResult> => {
  try {
    const validated = validateSecret(provider, kind, raw);
    if ("error" in validated) return { success: false, error: validated.error };
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: "OS secure storage unavailable" };
    }

    const target = getProfileSecretPath(profileId, provider, kind);
    await writeFile(
      target,
      safeStorage.encryptString(validated.value).toString("base64"),
      { encoding: "utf8", mode: 0o600 },
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to store key",
    };
  }
};

export const getProfileSecret = async (
  profileId: string,
  provider: ProviderId,
  kind: SecretKind,
): Promise<string | null> => {
  try {
    const content = await readFile(getProfileSecretPath(profileId, provider, kind), "utf8");
    if (!content.trim() || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(content, "base64"));
  } catch {
    return null;
  }
};

export const hasProfileSecret = async (
  profileId: string,
  provider: ProviderId,
  kind: SecretKind,
): Promise<boolean> => {
  try {
    const content = await readFile(getProfileSecretPath(profileId, provider, kind), "utf8");
    return Boolean(content.trim());
  } catch {
    return false;
  }
};

export const clearProfileSecret = async (
  profileId: string,
  provider: ProviderId,
  kind: SecretKind,
): Promise<SecretWriteResult> => {
  try {
    await rm(getProfileSecretPath(profileId, provider, kind), { force: true });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to clear key",
    };
  }
};

/**
 * Clears every credential that may belong to a deleted profile. A slot missed
 * here leaves the deleted profile's key on disk indefinitely, so the list stays
 * derived; and every slot is attempted even if an earlier one fails.
 */
export const clearProfileSecrets = async (
  profileId: string,
): Promise<SecretWriteResult> => {
  if (!isValidProfileId(profileId)) return invalidSecretTarget();
  const results = await Promise.all(
    PROVIDER_IDS.flatMap((provider) =>
      secretKindsForProvider(provider).map((kind) =>
        clearProfileSecret(profileId, provider, kind),
      ),
    ),
  );
  const failed = results.find((result) => !result.success);
  return failed ?? { success: true };
};

/**
 * Read a secret for whichever profile is active. An unsupported (provider, kind)
 * pair answers `null` rather than throwing. `apiStore` is imported dynamically:
 * a static import would create a load-time cycle, since the profile store's
 * migration path reaches back into this module.
 */
export const getActiveProfileSecret = async (
  provider: ProviderId,
  kind: SecretKind,
): Promise<string | null> => {
  if (!secretKindsForProvider(provider).includes(kind)) return null;
  const { getCurrentProfileId } = await import("~/features/providers/store/apiStore");
  const profileId = getCurrentProfileId();
  return profileId ? getProfileSecret(profileId, provider, kind) : null;
};
