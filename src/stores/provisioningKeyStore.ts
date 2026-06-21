/**
 * @file provisioningKeyStore.ts
 * @description Secure store for the OpenRouter PROVISIONING (admin) key.
 *
 * SECURITY (main-process only): this key can create/delete OpenRouter API keys
 * and spend money. It is persisted ONLY as OS-encrypted ciphertext via Electron
 * `safeStorage` (Keychain on macOS), written to a dedicated file under
 * `app.getPath("userData")`. It is NEVER stored in the hardcoded-key
 * electron-store files (apiStore/historyStore/keybindingStore use a public
 * source-visible encryptionKey — unacceptable for this key), and NEVER written
 * as plaintext on disk. The decrypted value stays in the main process; it is
 * deliberately NOT round-tripped to the renderer (the UI shows only a masked
 * set/not-set state). The secret is never logged.
 *
 * All disk I/O is async (`fs/promises`) per the main-process async-only rule.
 */
import { rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";

/** Absolute path to the encrypted provisioning-key file in userData. */
export const getProvisioningKeyPath = (): string =>
  path.join(app.getPath("userData"), "openrouter-provisioning.enc");

// ---------------------------------------------------------------------------
// Pure helpers (the unit-test seam — no electron, no fs).
// ---------------------------------------------------------------------------

/** OpenRouter provisioning keys conventionally start with this prefix. */
export const OPENROUTER_KEY_PREFIX = "sk-or-";

export type ValidateResult =
  | { ok: true; value: string; warning?: string }
  | { ok: false; error: string };

/**
 * Validate + normalize a provisioning-key input. Trims surrounding whitespace,
 * rejects empty/whitespace-only input. The `sk-or-` prefix is a SOFT warning
 * (not a hard block), mirroring the existing soft `sk-` check for the OpenAI
 * key in SettingGeneral (HITL #2 default).
 */
export const validateProvisioningKeyInput = (raw: string): ValidateResult => {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: "Provisioning key must not be empty" };
  }
  if (!value.startsWith(OPENROUTER_KEY_PREFIX)) {
    return {
      ok: true,
      value,
      warning: `Key does not start with "${OPENROUTER_KEY_PREFIX}" — saving anyway`,
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

/**
 * Treat empty/whitespace-only file content as "unset" (no key). Keeps the read
 * path's null-guard testable without touching electron/fs.
 */
export const isBlankStoredBlob = (content: string): boolean =>
  content.trim().length === 0;

// ---------------------------------------------------------------------------
// Electron-touching composition (safeStorage + fs/promises). Kept thin so the
// pure helpers above carry the unit-test coverage; these are exercised in
// `bun run dev` / QA where an OS keychain + Electron runtime are available.
// ---------------------------------------------------------------------------

export type SecretWriteResult = { success: boolean; error?: string };

const ENCRYPTION_UNAVAILABLE = "OS secure storage unavailable";

/**
 * Encrypt + persist the provisioning key. Returns a clear error (and writes
 * nothing) when OS encryption is unavailable — there is NO plaintext fallback.
 * Never logs the key.
 */
export const setProvisioningKey = async (
  raw: string
): Promise<SecretWriteResult> => {
  const validated = validateProvisioningKeyInput(raw);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: ENCRYPTION_UNAVAILABLE };
  }

  try {
    const cipher = safeStorage.encryptString(validated.value);
    await writeFile(getProvisioningKeyPath(), encodeCipherToDisk(cipher), {
      encoding: "utf8",
      mode: 0o600,
    });
    return { success: true };
  } catch (error) {
    // Surface a generic message — never include the key in the error.
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to store key",
    };
  }
};

/** Remove the stored key. `force` makes deleting a missing file a no-op. */
export const clearProvisioningKey = async (): Promise<SecretWriteResult> => {
  try {
    await rm(getProvisioningKeyPath(), { force: true });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to clear key",
    };
  }
};

/**
 * Decrypt + return the provisioning key for in-main callers (e.g. #59's
 * OpenRouter admin requests). Resolves to `null` — never throws — when the file
 * is missing/blank, when OS encryption is unavailable, or on any read/decrypt
 * failure. Keep this signature `(): Promise<string | null>` stable for #59.
 */
export const getProvisioningKey = async (): Promise<string | null> => {
  let b64: string;
  try {
    b64 = await readFile(getProvisioningKeyPath(), { encoding: "utf8" });
  } catch {
    // Missing file (or unreadable) → treated as unset.
    return null;
  }

  if (isBlankStoredBlob(b64)) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    // Can't decrypt without OS encryption; do not throw. Non-secret warning.
    console.warn(
      "provisioningKeyStore: stored key present but OS encryption unavailable; cannot decrypt"
    );
    return null;
  }

  try {
    return safeStorage.decryptString(decodeCipherFromDisk(b64));
  } catch {
    // Corrupt/incompatible blob → unset rather than throw.
    return null;
  }
};

/**
 * Cheap existence check for the masked UI state. Does NOT decrypt — only
 * reports whether a non-blank stored blob exists.
 */
export const hasProvisioningKey = async (): Promise<boolean> => {
  try {
    const b64 = await readFile(getProvisioningKeyPath(), { encoding: "utf8" });
    return !isBlankStoredBlob(b64);
  } catch {
    return false;
  }
};
