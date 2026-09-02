/**
 * @file ipcResultLabel.ts
 * @description Shared `Label`-wrapping helpers for `api.ts` / `profiles.ts`
 * IPC handlers (see the fixlang-i18n review note: validation errors these
 * handlers author inline must be translatable `Message`s; text that
 * originates elsewhere — a thrown exception, or a `{ success, error }` result
 * passed through from a store module such as `apiStore.ts`, `apiKeyStore.ts`,
 * or `profileSecretStore.ts` — is opaque and must survive untranslated).
 */
import { textLabel, type Label } from "~/features/i18n/shared/message";

/**
 * Wraps an unexpected exception's message as an opaque `Label` — `error` may
 * be anything a `catch` clause receives, so this never assumes `Error`.
 * These messages are diagnostic runtime text (a bug, a network failure, a
 * provider's SDK message), never app-authored UI copy, so they are always
 * `textLabel` (raw passthrough) — never translated.
 */
export const exceptionLabel = (error: unknown): Label =>
  textLabel(error instanceof Error ? error.message : String(error));

/**
 * Boundary-wraps a `{ success, error?: string }` result from a store module
 * into this file's `Label`-typed shape. Those stores are outside this
 * migration's scope, so their error text — whatever it is — is treated as
 * opaque and passed through untranslated via `textLabel`, never guessed at
 * as translatable.
 */
export const wrapStoreResult = <T extends { success: boolean; error?: string }>(
  result: T,
): Omit<T, "error"> & { error?: Label } => {
  const { error, ...rest } = result;
  return { ...rest, ...(error !== undefined ? { error: textLabel(error) } : {}) };
};
