/**
 * @file keystrokePermission.ts
 * @description Pure predicate for detecting macOS's "Accessibility
 * permission revoked" failure mode when synthesizing keystrokes via
 * `osascript` (the `System Events` `keystroke` command).
 *
 * Why this exists: after an unsigned app update, macOS invalidates the app's
 * TCC (Accessibility) grant because its code identity changed. Every
 * subsequent keystroke synthesis then fails with a message shaped like:
 *
 *   66:98: execution error: System Events got an error: osascript is not
 *   allowed to send keystrokes. (1002)
 *
 * `getHighlightedText`/`pasteText` (in `~/utils`) previously surfaced this to
 * the user as a generic "Failed to get highlighted text" — true, but useless:
 * it says nothing about permissions or how to fix it. This predicate lets
 * those call sites tell "permission revoked" apart from any *other*
 * `osascript`/System Events failure (a syntax error, System Events not
 * running, an unrelated automation-permission denial, a timeout, …) so only
 * the genuine permission case triggers the actionable
 * `promptAccessibilityPermission()` flow — a wrong "grant permission" prompt
 * in response to some unrelated failure would be more confusing than the
 * generic error it replaces.
 *
 * Dependency-free by design (no Electron, no Node built-ins) so it stays
 * trivially unit-testable and importable from anywhere in the process tree.
 */

/**
 * Matching strategy:
 *
 * - The literal phrase "not allowed to send keystrokes" (case-insensitive) is
 *   the primary signal. It is the exact wording macOS's AppleScript runtime
 *   uses for this specific denial and does not occur in any other
 *   `osascript`/System Events failure text, so alone it cannot misfire on an
 *   unrelated error.
 * - The `(1002)` OSA error code is a secondary, defense-in-depth signal only.
 *   It is genuinely tied to this failure, but Apple documents 1002 more
 *   broadly as "not authorized to send Apple events", so by itself it is not
 *   specific enough to safely key a permission prompt on — some other
 *   automation-permission denial could plausibly surface the same code with
 *   different wording. It is therefore only honored together with the word
 *   "keystrokes" appearing in the same message; it never fires alone.
 */
const KEYSTROKE_DENIAL_PHRASE = /not allowed to send keystrokes/i;
const KEYSTROKE_DENIAL_CODE = /\(1002\)/;
const MENTIONS_KEYSTROKES = /keystrokes/i;

/**
 * Extracts a message string from whatever shape a rejected promise/thrown
 * value might take, without ever throwing.
 *
 * `copyHighlightedText` in `~/utils` currently rejects with a **string**
 * (`` `Error: ${error.message}` ``), not an `Error` instance; `pasteText` may
 * differ; other call sites may pass a real `Error`, a `{ message }`-shaped
 * object, or arbitrary junk (`null`, `undefined`, numbers, plain objects).
 * Returns `undefined` for anything without extractable text.
 */
const extractMessage = (error: unknown): string | undefined => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return undefined;
};

/**
 * True when `error` looks like macOS's "Accessibility permission was
 * revoked" `osascript` failure, as opposed to some other `osascript`/System
 * Events error. See the module doc for the matching rationale. Never throws,
 * regardless of what `error` is.
 */
export const isKeystrokePermissionDenied = (error: unknown): boolean => {
  const message = extractMessage(error);
  if (message === undefined) return false;

  return (
    KEYSTROKE_DENIAL_PHRASE.test(message) ||
    (KEYSTROKE_DENIAL_CODE.test(message) && MENTIONS_KEYSTROKES.test(message))
  );
};
