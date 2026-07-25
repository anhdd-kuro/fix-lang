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
import type { ProviderId } from "~/stores/apiStore";

export type SecretKind = "api" | "provisioning";

export type SecretWriteResult = {
  success: boolean;
  warning?: string;
  error?: string;
};

const isValidProfileId = (profileId: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(profileId);

const isApiProvider = (provider: ProviderId): boolean =>
  provider === "openai" || provider === "openrouter";

const invalidSecretTarget = (): SecretWriteResult => ({
  success: false,
  error: "Invalid profile or provider",
});

/** Returns a deterministic encrypted-secret path for a profile/provider pair. */
export const getProfileSecretPath = (
  profileId: string,
  provider: ProviderId,
  kind: SecretKind,
): string => {
  if (!isValidProfileId(profileId)) {
    throw new Error("Invalid profile id");
  }
  if (kind === "api" && !isApiProvider(provider)) {
    throw new Error("Ollama does not use an API key");
  }
  if (kind === "provisioning" && provider !== "openrouter") {
    throw new Error("Only OpenRouter has a provisioning key");
  }

  return path.join(
    app.getPath("userData"),
    `${provider}-${kind}-key.${profileId}.enc`,
  );
};

const validateSecret = (
  raw: string,
  provider: ProviderId,
  kind: SecretKind,
): { value: string; warning?: string } | { error: string } => {
  const value = raw.trim();
  if (!value) return { error: "API key must not be empty" };

  const expectedPrefix =
    kind === "provisioning" || provider === "openrouter" ? "sk-or-" : "sk-";
  if (!value.startsWith(expectedPrefix)) {
    return {
      value,
      warning: `Key does not start with "${expectedPrefix}" — saving anyway`,
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
    const validated = validateSecret(raw, provider, kind);
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
    return {
      success: true,
      ...(validated.warning ? { warning: validated.warning } : {}),
    };
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

/** Clears every credential that may belong to a deleted profile. */
export const clearProfileSecrets = async (
  profileId: string,
): Promise<SecretWriteResult> => {
  if (!isValidProfileId(profileId)) return invalidSecretTarget();
  const results = await Promise.all([
    clearProfileSecret(profileId, "openai", "api"),
    clearProfileSecret(profileId, "openrouter", "api"),
    clearProfileSecret(profileId, "openrouter", "provisioning"),
  ]);
  const failed = results.find((result) => !result.success);
  return failed ?? { success: true };
};
