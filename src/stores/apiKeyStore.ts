/**
 * @file apiKeyStore.ts
 * @description Secure store for the main OpenAI / OpenRouter API key.
 *
 * SECURITY (main-process only): mirrors provisioningKeyStore.ts but for the
 * primary API key. Stored as OS-encrypted ciphertext via Electron `safeStorage`
 * (Keychain on macOS) in `openai-api-key.enc` under userData. The decrypted
 * value never leaves the main process; the renderer tracks only a boolean
 * set/not-set state. The key is never logged.
 *
 * All disk I/O is async (`fs/promises`) per the main-process async-only rule.
 */
import { rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";

/** Absolute path to the encrypted API key file in userData. */
export const getApiKeyPath = (): string =>
  path.join(app.getPath("userData"), "openai-api-key.enc");

// ---------------------------------------------------------------------------
// Pure helpers (unit-test seam — no electron, no fs).
// ---------------------------------------------------------------------------

/** OpenAI API keys conventionally start with this prefix. */
export const OPENAI_KEY_PREFIX = "sk-";

export type ValidateResult =
  | { ok: true; value: string; warning?: string }
  | { ok: false; error: string };

/**
 * Validate + normalize an API key input. Trims surrounding whitespace, rejects
 * empty/whitespace-only input. The `sk-` prefix is a SOFT warning (not a hard
 * block), mirroring the provisioning key's `sk-or-` soft check.
 */
export const validateApiKeyInput = (raw: string): ValidateResult => {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: "API key must not be empty" };
  }
  if (!value.startsWith(OPENAI_KEY_PREFIX)) {
    return {
      ok: true,
      value,
      warning: `Key does not start with "${OPENAI_KEY_PREFIX}" — saving anyway`,
    };
  }
  return { ok: true, value };
};

/** Encode an encrypted cipher Buffer to the base64 string stored on disk. */
export const encodeCipherToDisk = (cipher: Buffer): string =>
  cipher.toString("base64");

/** Decode the base64 disk blob back into the cipher Buffer for decryption. */
export const decodeCipherFromDisk = (b64: string): Buffer =>
  Buffer.from(b64, "base64");

/** Treat empty/whitespace-only file content as "unset" (no key). */
export const isBlankStoredBlob = (content: string): boolean =>
  content.trim().length === 0;

// ---------------------------------------------------------------------------
// Electron-touching composition (safeStorage + fs/promises).
// ---------------------------------------------------------------------------

export type SecretWriteResult = {
  success: boolean;
  warning?: string;
  error?: string;
};

const ENCRYPTION_UNAVAILABLE = "OS secure storage unavailable";

/**
 * Encrypt + persist the API key. Returns a clear error (and writes nothing)
 * when OS encryption is unavailable — there is NO plaintext fallback.
 * Never logs the key.
 */
export const setApiKey = async (raw: string): Promise<SecretWriteResult> => {
  const validated = validateApiKeyInput(raw);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: ENCRYPTION_UNAVAILABLE };
  }

  try {
    const cipher = safeStorage.encryptString(validated.value);
    await writeFile(getApiKeyPath(), encodeCipherToDisk(cipher), {
      encoding: "utf8",
      mode: 0o600,
    });
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

/** Remove the stored key. `force` makes deleting a missing file a no-op. */
export const clearApiKey = async (): Promise<SecretWriteResult> => {
  try {
    await rm(getApiKeyPath(), { force: true });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to clear key",
    };
  }
};

/**
 * Decrypt + return the API key for in-main callers (e.g. AI request handlers).
 * Resolves to `null` — never throws — when the file is missing/blank, when OS
 * encryption is unavailable, or on any read/decrypt failure.
 */
export const getApiKey = async (): Promise<string | null> => {
  let b64: string;
  try {
    b64 = await readFile(getApiKeyPath(), { encoding: "utf8" });
  } catch {
    return null;
  }

  if (isBlankStoredBlob(b64)) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      "apiKeyStore: stored key present but OS encryption unavailable; cannot decrypt",
    );
    return null;
  }

  try {
    return safeStorage.decryptString(decodeCipherFromDisk(b64));
  } catch {
    return null;
  }
};

/**
 * Cheap existence check for the masked UI state. Does NOT decrypt — only
 * reports whether a non-blank stored blob exists.
 */
export const hasApiKey = async (): Promise<boolean> => {
  try {
    const b64 = await readFile(getApiKeyPath(), { encoding: "utf8" });
    return !isBlankStoredBlob(b64);
  } catch {
    return false;
  }
};
