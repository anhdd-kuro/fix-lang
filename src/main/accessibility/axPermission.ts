/**
 * @file axPermission.ts
 * @description Pure predicate for detecting macOS's "Accessibility
 * permission revoked" failure mode when *reading* AX attributes via
 * `osascript` (the `System Events` `value of attribute` calls in
 * `selectedText.ts`).
 *
 * This is a deliberate SIBLING of `keystrokePermission.ts`, not an extension
 * of it: that predicate targets the "not allowed to send keystrokes" denial
 * `pasteText`/`copyHighlightedText` hit, which is worded completely
 * differently from an assistive-access denial on an attribute *read*. Sharing
 * one regex across both would either miss this failure mode or start
 * misfiring on the other's error text, so each channel gets its own matcher.
 */

/**
 * Matching strategy:
 *
 * - `/assistive access/i` and `/not authorized to send Apple events/i` are
 *   the primary signals — the literal wording macOS/System Events uses for
 *   "this app is not permitted to automate/read the target app", and neither
 *   occurs in any other `osascript` failure text.
 * - `-1743` (errAEEventNotPermitted) and `-25211` are OSA error codes tied to
 *   the same denial, checked as defense-in-depth alongside the phrases above.
 *   They are matched ONLY in the parenthesised trailing form `osascript`
 *   actually emits (`… assistive access. (-1743)`), never as a bare substring.
 *   The error text this predicate is handed can quote a value from the target
 *   app, so an unanchored `/-1743/` would let an ordinary selection — a diff
 *   line, a negative id, a phone number — flip `permissionDenied` and pop the
 *   System Settings dialog on a perfectly healthy grant.
 * - `-1728` ("Can't get attribute …", a plain "this attribute doesn't exist
 *   on this element" error) is deliberately NOT matched. It was observed in a
 *   live probe against a perfectly ordinary, permission-granted app — every
 *   element that has no `AXSelectedText` (or no focused element at all)
 *   surfaces this code, so treating it as a permission problem would
 *   misdiagnose the single most common non-error outcome of this read.
 */
const ASSISTIVE_ACCESS_PHRASE = /assistive access/i;
const APPLE_EVENT_DENIAL_PHRASE = /not authorized to send Apple events/i;
const AX_DENIAL_CODE = /\((?:-1743|-25211)\)/;

/**
 * Extracts a message string from whatever shape a rejected promise/thrown
 * value might take, without ever throwing. Mirrors `keystrokePermission.ts`'s
 * `extractMessage` — kept as a private duplicate rather than a shared import
 * so each predicate stays a standalone, dependency-free module.
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
 * True when `error` looks like macOS's "Accessibility/Apple-event permission
 * denied" failure, as opposed to an unrelated `osascript`/System Events error
 * (including the very common "attribute doesn't exist" `-1728`). Never
 * throws, regardless of what `error` is.
 */
export const isAxPermissionDenied = (error: unknown): boolean => {
  const message = extractMessage(error);
  if (message === undefined) return false;

  return (
    ASSISTIVE_ACCESS_PHRASE.test(message) ||
    APPLE_EVENT_DENIAL_PHRASE.test(message) ||
    AX_DENIAL_CODE.test(message)
  );
};
