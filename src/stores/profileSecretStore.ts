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
import {
  PROVIDER_IDS,
  PROVIDER_LOG_LABELS,
  PROVIDER_REQUIRES_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
} from "~/shared/providers";
import type { ProviderId } from "~/stores/apiStore";

export type SecretKind = "api" | "provisioning";

export type SecretWriteResult = {
  success: boolean;
  error?: string;
};

const isValidProfileId = (profileId: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(profileId);

/**
 * The credential slots a provider actually has, derived from the provider
 * tables rather than from per-provider branches.
 *
 * This is the single place the answer is computed, so adding a provider to
 * `PROVIDER_IDS` needs no edit in this file: it inherits the right slots from
 * `PROVIDER_REQUIRES_API_KEY` / `PROVIDER_SUPPORTS_PROVISIONING_KEY`. The
 * hand-written version silently gave a new provider *no* slots, which reads
 * as "this provider has no credentials to clear" — so deleting a profile
 * would leave its key on disk.
 */
export const secretKindsForProvider = (provider: ProviderId): SecretKind[] => [
  ...(PROVIDER_REQUIRES_API_KEY[provider] ? (["api"] as const) : []),
  ...(PROVIDER_SUPPORTS_PROVISIONING_KEY[provider] ? (["provisioning"] as const) : []),
];

/** Providers that have a provisioning key at all, for the guard's message. */
const provisioningProviderNames = (): string =>
  PROVIDER_IDS.filter((provider) => PROVIDER_SUPPORTS_PROVISIONING_KEY[provider])
    .map((provider) => PROVIDER_LOG_LABELS[provider])
    .join(" and ");

const invalidSecretTarget = (): SecretWriteResult => ({
  success: false,
  error: "Invalid profile or provider",
});

/**
 * Returns a deterministic encrypted-secret path for a profile/provider pair.
 *
 * The two guards are diagnostics for a programmer error (asking for a slot
 * the provider has not got), which is why they interpolate
 * `PROVIDER_LOG_LABELS` — the non-i18n diagnostics map — rather than a
 * catalog string. They are unreachable through the UI: every caller picks its
 * pairs from `secretKindsForProvider`.
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
        : `Only ${provisioningProviderNames()} has a provisioning key`,
    );
  }

  return path.join(
    app.getPath("userData"),
    `${provider}-${kind}-key.${profileId}.enc`,
  );
};

/**
 * A key that doesn't start with the provider's conventional prefix (`sk-` /
 * `sk-or-`) is still accepted — this only rejects empty/whitespace input.
 * There is no consumer for a "wrong prefix" advisory (nothing ever reads it
 * past this store), so this validates without producing one.
 */
const validateSecret = (raw: string): { value: string } | { error: string } => {
  const value = raw.trim();
  if (!value) return { error: "API key must not be empty" };
  return { value };
};

export const setProfileSecret = async (
  profileId: string,
  provider: ProviderId,
  kind: SecretKind,
  raw: string,
): Promise<SecretWriteResult> => {
  try {
    const validated = validateSecret(raw);
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
 * Clears every credential that may belong to a deleted profile.
 *
 * The slot list is derived, not written out: a provider added to
 * `PROVIDER_IDS` is cleaned up here automatically. A missed slot means a
 * deleted profile's API key stays on disk indefinitely, which no test of the
 * *remaining* slots would notice.
 *
 * Every slot is attempted even if an earlier one fails (`Promise.all` over
 * calls already in flight), so one locked file cannot strand the others.
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
 * Read a secret for whichever profile is active, or `null`.
 *
 * Exists so callers stop hand-rolling
 * `provider === "openrouter" ? getProvisioningKey() : getApiKey()` and the
 * "does this provider even have that slot?" branch that goes with it. An
 * unsupported (provider, kind) pair is `null`, not a throw: "this provider
 * has no such credential" is an ordinary answer, not an error.
 *
 * `apiStore` is imported dynamically, matching `apiKeyStore.activeProfileId`
 * — a static import would make this store depend on the profile store at
 * module load, and the profile store's migration path reaches back here.
 */
export const getActiveProfileSecret = async (
  provider: ProviderId,
  kind: SecretKind,
): Promise<string | null> => {
  if (!secretKindsForProvider(provider).includes(kind)) return null;
  const { getCurrentProfileId } = await import("~/stores/apiStore");
  const profileId = getCurrentProfileId();
  return profileId ? getProfileSecret(profileId, provider, kind) : null;
};
