/**
 * @file selectedText.ts
 * @description Reads the frontmost app's current text selection through the
 * same System Events/Accessibility channel `activeApp.ts` uses, so a
 * transform can read a selection directly instead of round-tripping through
 * the clipboard (⌘C). Best-effort and read-only: every failure path resolves
 * `"unavailable"` rather than rejecting, so a caller can always fall back to
 * the clipboard without a try/catch.
 */
import { execFile } from "child_process";
import { logger } from "~/main/logging/logService";
import { isAxPermissionDenied } from "./axPermission";

export type AxSelectedTextStatus = "ok" | "empty" | "unavailable" | "secure";

/**
 * `selectedText` carries the user's raw plaintext selection. The field name is
 * load-bearing, not cosmetic: `SENSITIVE_KEY` in `~/shared/logging.ts` matches
 * `selected[-_]?text`, so a consumer that logs this result by spreading it
 * (`{ ...result }`) gets `[REDACTED]` from the structural redactor for free. A
 * plainer name like `text` matches nothing in that pattern and would write the
 * selection to the on-disk JSONL unredacted. Do not rename it back.
 */
export type AxSelectedTextResult = {
  status: AxSelectedTextStatus;
  role: string;
  selectedText: string;
  permissionDenied: boolean;
};

/**
 * Matches `ACTIVE_APP_TIMEOUT_MS` in `activeApp.ts` — a measured typical read
 * is ~300ms, so 1.5s only has to catch a beachballed frontmost app.
 */
const SELECTED_TEXT_TIMEOUT_MS = 1_500;

/**
 * A selection past this size resolves `"unavailable"` rather than rejecting —
 * the clipboard fallback handles arbitrarily large text fine, so there is no
 * reason to let a pathologically large selection blow up this read.
 */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Second line of defence behind the script's own secure check.
 *
 * CAVEMAN: password field NOT have secure ROLE. Secure live in SUBROLE.
 * `AXSecureTextField` is a **subrole** (`AXRoleConstants.h:408`,
 * `kAXSecureTextFieldSubrole`, under "standard subroles"); a secure field's
 * *role* is the plain `AXTextField` (`AXRoleConstants.h:360`). A live probe on
 * a real macOS secure field returns `role=AXTextField
 * subrole=AXSecureTextField`. So do NOT "simplify" the script's subrole read
 * away — matching on role alone is what made this guard dead code once, and a
 * password then reads out like any other text field.
 *
 * `AXPasswordField` exists in no macOS SDK header (zero grep hits) and is kept
 * only as cheap insurance against a non-native AX provider inventing it as a
 * role of its own.
 */
const SECURE_ROLES = new Set(["AXSecureTextField", "AXPasswordField"]);

/**
 * CAVEMAN: script write frame end word, parser check same word — used to be
 * TWO copies of "EOT" (one in script, one in parser), no link between them.
 * Rename one side, other side not know, tests still green, feature go dark
 * silent (frame check always fail -> unavailable -> caller fall back to ⌘C).
 * Same drift bug class as old secure-role bug, one level up. Fix: script
 * template pull THIS constant in via `${EOT_FRAME}` (see
 * `SELECTED_TEXT_SCRIPT` below), so one constant feed both producer and
 * consumer — cannot drift because there is only one place the word lives.
 * Safe to interpolate: `EOT_FRAME` is a compile-time string constant, never
 * user input, and the whole script still goes through
 * `execFile("osascript", ["-e", SELECTED_TEXT_SCRIPT])` with no shell — so
 * this interpolation opens no injection surface, unlike the shell-string
 * concern `runSelectedTextScript`'s own comment documents below.
 */
const EOT_FRAME = "EOT";

/**
 * Frame statuses the AppleScript below can print. `SECURE` and `DENIED` are
 * decided inside the script on purpose — see `SELECTED_TEXT_SCRIPT`.
 */
const FRAME_STATUS = {
  ok: "OK",
  noSelection: "NOSEL",
  uncoercibleSelection: "NOTEXT",
  secureField: "SECURE",
  permissionDenied: "DENIED",
} as const;

/**
 * Fresh object per call, never a shared constant: three separate paths return
 * an unavailable result, and handing all of them one object means a single
 * caller mutation (`result.permissionDenied = true`) poisons every later
 * unavailable read for the life of the process — which downstream keys the
 * actionable System Settings dialog off, so the app would prompt for
 * Accessibility on every miss forever on a perfectly healthy grant.
 */
const unavailableResult = (permissionDenied = false): AxSelectedTextResult => ({
  status: "unavailable",
  role: "",
  selectedText: "",
  permissionDenied,
});

/**
 * Two decisions deliberately live in the script rather than in the parser:
 *
 * 1. **Secure fields.** The role/subrole check returns a `SECURE` frame
 *    *without ever evaluating `AXSelectedText`*, so a password never leaves
 *    the target process. Dropping it in the parser instead would still push
 *    the plaintext across the pipe into Node's stdout buffer first.
 * 2. **Permission denial.** The `AXFocusedUIElement` read is the first real AX
 *    read, so a revoked Accessibility grant surfaces there as `-25211` /
 *    `-1743`. An unqualified `try` would swallow it, the script would print
 *    `NOELEM` and exit 0, and `permissionDenied` could never become true.
 *    Only the error *number* is inspected — the error *message* is never put
 *    in the frame, because AppleScript quotes the offending value into it.
 *
 * Both `AXRole` and `AXSubrole` are sentinel-checked (`is not missing value`)
 * BEFORE coercion, not after: `(missing value) as text` yields the literal
 * string `"missing value"` rather than failing or giving `""` (verified
 * live), so coercing first would compare that string against the secure
 * names — and, for role, flow into the returned result and the debug log as
 * a bogus role — instead of classifying nothing. Conversely `"missing value"
 * is missing value` is false, so a real value that happens to be that string
 * cannot collide with the sentinel.
 *
 * A role or subrole read that *throws* leaves `r`/`sr` empty and so fails
 * OPEN, and that is deliberate: most elements carry no `AXSubrole` at all, so
 * treating an unreadable subrole (or role) as secure would classify ordinary
 * text fields as password fields and disable the whole feature. Failing
 * closed here would trade a rare leak for a guaranteed outage; the parser's
 * `SECURE_ROLES` backstop stays in place for that path.
 *
 * Every attribute read stays inside its own `try`, including the final
 * `as text` coercion: a value that will not coerce must degrade to a miss, not
 * escape as an `osascript` error whose text quotes the user's selection into
 * the persisted JSONL.
 */
const SELECTED_TEXT_SCRIPT = `
tell application "System Events"
  set secureIdentifiers to {"AXSecureTextField", "AXPasswordField"}
  set p to first application process whose frontmost is true
  set fe to missing value
  try
    set fe to value of attribute "AXFocusedUIElement" of p
  on error number errNum
    if errNum is -25211 or errNum is -1743 then return "DENIED" & tab & "" & tab & "" & tab & "${EOT_FRAME}"
    return "NOELEM" & tab & "" & tab & "" & tab & "${EOT_FRAME}"
  end try
  if fe is missing value then return "NOELEM" & tab & "" & tab & "" & tab & "${EOT_FRAME}"
  set r to ""
  try
    set roleValue to value of attribute "AXRole" of fe
    if roleValue is not missing value then set r to (roleValue as text)
  end try
  set sr to ""
  try
    set subroleValue to value of attribute "AXSubrole" of fe
    if subroleValue is not missing value then set sr to (subroleValue as text)
  end try
  if r is in secureIdentifiers or sr is in secureIdentifiers then
    return "SECURE" & tab & r & tab & "" & tab & "${EOT_FRAME}"
  end if
  set s to missing value
  try
    set s to value of attribute "AXSelectedText" of fe
  end try
  if s is missing value then return "NOSEL" & tab & r & tab & "" & tab & "${EOT_FRAME}"
  set selectionText to missing value
  try
    set selectionText to s as text
  end try
  if selectionText is missing value then return "NOTEXT" & tab & r & tab & "" & tab & "${EOT_FRAME}"
  return "OK" & tab & r & tab & selectionText & tab & "${EOT_FRAME}"
end tell
`;

/**
 * Parse the `STATUS \t ROLE \t TEXT \t EOT` line the AppleScript prints.
 *
 * The selection itself can contain tabs and newlines, so a plain
 * `split("\t")` would slice it apart. Instead STATUS and ROLE are read off
 * the front (neither one can contain a tab), and TEXT is everything between
 * the second tab and the LAST tab in the line — the one immediately before
 * the literal "EOT" frame, which never occurs inside the text itself.
 *
 * CRITICAL: the text is never `.trim()`-ed and no control characters are
 * stripped here. Unlike an app name, leading/trailing whitespace and embedded
 * control characters are part of what the user selected — `activeApp.ts`'s
 * control-stripping is deliberately not reused.
 */
export const parseSelectedTextResult = (stdout: string): AxSelectedTextResult => {
  const line = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;

  const firstTab = line.indexOf("\t");
  const secondTab = firstTab === -1 ? -1 : line.indexOf("\t", firstTab + 1);
  const lastTab = line.lastIndexOf("\t");

  const frameIsWellFormed =
    firstTab !== -1 &&
    secondTab !== -1 &&
    lastTab > secondTab &&
    line.slice(lastTab + 1) === EOT_FRAME;

  if (!frameIsWellFormed) return unavailableResult();

  const status = line.slice(0, firstTab);
  const role = line.slice(firstTab + 1, secondTab);
  const selectedText = line.slice(secondTab + 1, lastTab);

  // The role test is redundant against the real script (which reports a secure
  // field's honest `AXTextField` role and decides on the subrole) and is kept
  // as a backstop for an AX provider that reports a secure name as the role.
  if (status === FRAME_STATUS.secureField || SECURE_ROLES.has(role)) {
    return { status: "secure", role, selectedText: "", permissionDenied: false };
  }

  if (status === FRAME_STATUS.permissionDenied) return unavailableResult(true);

  if (status === FRAME_STATUS.ok) {
    return { status: "ok", role, selectedText, permissionDenied: false };
  }

  if (status === FRAME_STATUS.noSelection) {
    return { status: "empty", role, selectedText: "", permissionDenied: false };
  }

  // A selection that would not coerce to text. Unavailable rather than empty —
  // there *was* a selection — and the role is kept so the log names the kind of
  // element whose AX provider returned something uncoercible.
  if (status === FRAME_STATUS.uncoercibleSelection) {
    return { status: "unavailable", role, selectedText: "", permissionDenied: false };
  }

  // NOELEM, or any unrecognized status string.
  return unavailableResult();
};

/**
 * `execFile`, not `exec`: the script used to be interpolated into an
 * `osascript -e '<script>'` shell string, which stays correct only as long as
 * the script contains no apostrophe. The day one appears ("Can't", "don't")
 * the quote closes early, `/bin/sh` fails with `Unmatched '`, and — because
 * every failure here collapses to `"unavailable"` — AX reads switch off
 * silently with nothing but a warn line. No shell means no quoting class at
 * all. `timeout` and `maxBuffer` behave identically.
 */
const runSelectedTextScript = (): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", SELECTED_TEXT_SCRIPT],
      { timeout: SELECTED_TEXT_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

const READ_LOG_MESSAGE: Record<AxSelectedTextStatus, string> = {
  ok: "Selection read",
  empty: "No selection",
  secure: "Secure field skipped",
  unavailable: "Selection unavailable",
};

type SelectedTextReadFailureReason =
  | "permissionDenied"
  | "outputTooLarge"
  | "timedOut"
  | "execFailed";

/**
 * `execFile`'s `error.code` is either a Node errno string (`"ENOENT"`,
 * `"ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`) or a bare exit-status number — never
 * the target app's stderr — so it is safe to persist on its own, unlike
 * `error.message` below.
 */
const errorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;

  const { code } = error as { code: unknown };
  return typeof code === "string" || typeof code === "number" ? String(code) : null;
};

const wasKilled = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "killed" in error &&
  Boolean((error as { killed: unknown }).killed);

/**
 * Classifies an exec failure into a closed set of short reasons instead of
 * persisting `error.message`. `execFile` sets that message to `Command
 * failed: osascript -e <the entire ~1.3 KB script>` followed by stderr — and
 * the stderr half can quote the frontmost window's title and full UI element
 * path, i.e. the user's application and document context. The script text is
 * a source constant that never needs persisting, and the window title is
 * exactly what must never reach `userData/logs/{day}/fixlang.jsonl` (and, from
 * there, every Logs-tab export) for a failure mode this routine.
 */
const describeReadFailure = (
  error: unknown,
  permissionDenied: boolean,
): { code: string | null; reason: SelectedTextReadFailureReason } => {
  const code = errorCode(error);

  if (permissionDenied) return { code, reason: "permissionDenied" };
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { code, reason: "outputTooLarge" };
  if (wasKilled(error)) return { code, reason: "timedOut" };

  return { code, reason: "execFailed" };
};

/**
 * Best-effort read of the frontmost app's focused-element selection. Never
 * rejects: any osascript failure (timeout, oversized selection, revoked
 * Accessibility permission, non-darwin) resolves `"unavailable"` instead, so
 * a caller can fall back to the clipboard unconditionally.
 */
export const getAxSelectedText = async (): Promise<AxSelectedTextResult> => {
  if (process.platform !== "darwin") return unavailableResult();

  try {
    const stdout = await runSelectedTextScript();
    const result = parseSelectedTextResult(stdout);

    // Debug level, never the text itself: this is the only signal for
    // whether a request had a real AX selection to work with.
    logger.debug("accessibility.selectedText", READ_LOG_MESSAGE[result.status], {
      status: result.status,
      role: result.role,
      permissionDenied: result.permissionDenied,
    });

    return result;
  } catch (error) {
    // `isAxPermissionDenied` still receives the raw `error` — the full message
    // text is exactly what it classifies on — only the LOG below is shortened.
    const permissionDenied = isAxPermissionDenied(error);
    const { code, reason } = describeReadFailure(error, permissionDenied);

    // Warn, not error, and never surfaced to the user: the caller falls back
    // to the clipboard, so this is not a user-facing failure by itself.
    logger.warn("accessibility.selectedText", "Failed to read the selection", {
      code,
      reason,
    });

    return unavailableResult(permissionDenied);
  }
};
