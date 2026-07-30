import { exec, execSync } from "child_process";
import { clipboard, dialog, shell } from "electron";
import { logActiveAppRead, parseActiveApp } from "~/main/accessibility/activeApp";
import { isKeystrokePermissionDenied } from "~/main/accessibility/keystrokePermission";
import { logger } from "~/main/logging/logService";
import { AccessibilityPermissionError } from "~/main/notifications/error";
import type { ActiveApp } from "~/main/accessibility/activeApp";

export const isMacOSAccessibilityGranted = (): boolean => {
  if (process.platform !== "darwin") return true;

  try {
    const applescript = `
      tell application "System Events"
        set UI_enabled to UI elements enabled
      end tell
      return UI_enabled
    `;
    const result = execSync(`osascript -e '${applescript}'`).toString().trim();
    return result === "true";
  } catch (error) {
    console.error("Error checking Accessibility permission:", error);
    return false;
  }
};

// At most one dialog per interval. The blocking `showMessageBoxSync` this
// replaces would previously stack a modal per failed hotkey press — a
// correction hotkey that fails repeatedly (the observed case: four failures
// in 31 seconds as the user retried) would otherwise freeze the main process
// behind four queued dialogs. 60s comfortably absorbs a rapid retry burst
// like that into a single prompt, while still being short enough that a
// later, genuinely new failure in the same session re-prompts instead of
// being silenced for good by one early dialog.
const ACCESSIBILITY_PROMPT_THROTTLE_MS = 60 * 1000;
let lastAccessibilityPromptAt = 0;

export const promptAccessibilityPermission = async (): Promise<void> => {
  if (process.platform !== "darwin") return;

  const now = Date.now();
  if (now - lastAccessibilityPromptAt < ACCESSIBILITY_PROMPT_THROTTLE_MS) return;
  lastAccessibilityPromptAt = now;

  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Open Settings", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Accessibility Permission Required",
    message: "FixLang needs Accessibility permission to simulate keystrokes.",
    detail:
      "Please enable accessibility for this app in System Settings > Privacy & Security > Accessibility.",
  });

  if (response === 0) {
    // Open Accessibility Settings
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    );
  }
};

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let clipboardOperationsInFlight = 0;

/**
 * Poll tick for `finishClipboardRead` below. A pasteboard write from a
 * synthesized Cmd-C typically lands in well under 20ms, so this is tight
 * enough to notice the change almost immediately instead of always paying
 * out a fixed sleep (the ~200ms of hardcoded `delay` this replaced).
 */
const CLIPBOARD_POLL_INTERVAL_MS = 10;

/**
 * How long `finishClipboardRead` waits for the pasteboard to change before
 * giving up.
 *
 * This MUST be set explicitly — `waitForClipboardChange`'s own default is 3s,
 * which is a sane budget for its original caller but catastrophic here. When
 * nothing is selected the synthesized Cmd-C is a no-op, so the clipboard never
 * changes and the poll always runs to its full timeout. That is the NORMAL
 * case for Ask AI, so inheriting 3s made its hotkey sit unresponsive for three
 * seconds before the input window opened — far worse than the ~200ms of fixed
 * `delay` the poll replaced.
 *
 * Chosen against the opposite risk rather than for pure speed: the copy
 * keystroke's `osascript` has already exited by the time the poll starts, but
 * the target app writes the pasteboard on its own schedule, so a slow app can
 * still land it a little later. Timing out too early reports "unchanged",
 * which on the strict path returns the PREVIOUS clipboard — silently
 * transforming the wrong text, a much worse failure than a short wait. 500ms
 * is ~5x the old fixed 100ms post-keystroke delay, so an app that was fast
 * enough before is comfortably inside it, while the no-selection case now
 * costs 0.5s instead of 3s.
 */
const CLIPBOARD_CHANGE_TIMEOUT_MS = 500;

/**
 * Maps a copy-keystroke failure to the right thrown error: a revoked
 * Accessibility permission (see `~/main/accessibility/keystrokePermission`)
 * becomes `AccessibilityPermissionError` so callers can trigger the
 * actionable re-grant prompt; anything else becomes a generic wrapper that
 * still carries the original failure as `cause`.
 */
const toSelectionError = (error: unknown): Error => {
  if (isKeystrokePermissionDenied(error)) {
    return new AccessibilityPermissionError();
  }
  return new Error("Failed to get highlighted text", { cause: error });
};

const logCopyKeystrokeFailure = (error: unknown, startedAt: number): void => {
  logger.warn("clipboard.copy", "Copy keystroke failed", {
    elapsedMs: Date.now() - startedAt,
    permissionDenied: isKeystrokePermissionDenied(error),
  });
  console.error(error);
};

/**
 * Polls the clipboard for a CHANGE (via `waitForClipboardChange`) rather than
 * reading the clipboard back from AppleScript itself: selection text can
 * contain tabs/newlines that would be unparseable if bundled into one
 * `osascript` stdout blob alongside app-name/bundle-id, and this is also what
 * lets `getHighlightedText`/`getHighlightedTextForOptionalContext`/
 * `getHighlightedTextWithActiveApp` share one "did the copy actually put
 * something new on the pasteboard" signal instead of each parsing it
 * differently.
 *
 * `value` is always whatever the clipboard holds once the poll settles —
 * the new content when it changed, or the untouched `previousClipboardContent`
 * on a timeout/no-op — regardless of `changed`. A poll can only ever tell
 * "did the pasteboard value change", never "was there really a selection this
 * time": those two questions have the same answer when nothing was ever
 * copied before, but diverge the moment a real selection happens to be
 * byte-identical to whatever was already on the clipboard. Callers decide for
 * themselves which of `value`/`changed` to use — see the very different
 * choices `getHighlightedText` and `getHighlightedTextForOptionalContext`
 * make below.
 */
const finishClipboardRead = async (
  previousClipboardContent: string,
): Promise<{ value: string; changed: boolean }> => {
  const value = await waitForClipboardChange({
    oldValue: previousClipboardContent,
    interval: CLIPBOARD_POLL_INTERVAL_MS,
    timeout: CLIPBOARD_CHANGE_TIMEOUT_MS,
  });
  return { value, changed: value !== previousClipboardContent };
};

type SelectionRead = {
  value: string;
  changed: boolean;
};

/**
 * Shared body behind `getHighlightedText` and
 * `getHighlightedTextForOptionalContext`: snapshots the clipboard, sends the
 * Cmd-C via `sendCopyKeystroke`, restores the clipboard in `finally` (running
 * on every path for both callers), and maps a revoked Accessibility
 * permission to `AccessibilityPermissionError` — everything the two exported
 * functions need to stay byte-identical on their own error handling. Returns
 * both `value` and `changed` unfiltered; each exported wrapper below decides
 * on its own what an unchanged clipboard should mean for its caller.
 */
const readSelection = async (): Promise<SelectionRead> => {
  const previousClipboardContent = clipboard.readText();
  const startedAt = Date.now();
  clipboardOperationsInFlight += 1;

  logger.debug("clipboard.copy", "Sending copy keystroke", {
    previousLength: previousClipboardContent.length,
    concurrentOps: clipboardOperationsInFlight,
  });

  try {
    await sendCopyKeystroke();
    const { value, changed } = await finishClipboardRead(previousClipboardContent);

    logger.debug("clipboard.copy", "Copy keystroke returned", {
      copiedLength: value.length,
      previousLength: previousClipboardContent.length,
      clipboardChanged: changed,
      elapsedMs: Date.now() - startedAt,
    });

    return { value, changed };
  } catch (error) {
    logCopyKeystrokeFailure(error, startedAt);
    throw toSelectionError(error);
  } finally {
    clipboard.writeText(previousClipboardContent);
    clipboardOperationsInFlight -= 1;
    logger.debug("clipboard.copy", "Previous clipboard restored", {
      elapsedMs: Date.now() - startedAt,
      concurrentOps: clipboardOperationsInFlight,
    });
  }
};

/**
 * Strict variant, used by PromptGen and (via `getHighlightedTextWithActiveApp`
 * below) the correction hotkey's ordinary preset branch. Deliberately gains NO
 * stale-clipboard protection from the change-poll: it returns whatever the
 * clipboard holds once the poll settles, changed or not — byte-for-byte the
 * same answer this gave before the poll existed (the poll only replaced the
 * fixed `delay`, it did not change what gets returned here).
 *
 * This is intentional, not an oversight. Losing that fallback would break a
 * genuine workflow: copy a paragraph, paste it into an editor, select that
 * same text again, hit a transform hotkey — the clipboard never "changes"
 * because the selection is byte-identical to what was already on it, so
 * treating "unchanged" as "nothing selected" would abort a real selection.
 * The trade-off this accepts: nothing selected (Cmd-C a no-op) is
 * indistinguishable from that case, so a stale previous clipboard can still
 * reach the transform as if it were the selection — exactly as before. That
 * is an acceptable cost here specifically because callers of this function
 * already abort on a truly EMPTY clipboard (see
 * `!selectedText || !selectedText.trim()` in `correction.ts`/`promptGen.ts`):
 * the failure mode is a wasted transform, not a leak. Contrast
 * `getHighlightedTextForOptionalContext` below, which has no such abort and
 * therefore cannot afford the same trade-off.
 */
export const getHighlightedText = async (): Promise<string> => {
  const { value } = await readSelection();
  return value;
};

/**
 * Optional-context variant for presets where an empty selection is the
 * NORMAL case (currently only Ask AI) — unlike the six polish presets, which
 * abort outright when `getHighlightedText` comes back empty, so a stale
 * clipboard reaching them was harmless.
 *
 * With nothing selected, the synthesized Cmd-C is a no-op, so the clipboard
 * never changes — indistinguishable from a real selection unless compared
 * against the pre-copy snapshot. Unlike `getHighlightedText` above, THIS
 * variant reports "" whenever `changed` is false, instead of falling back to
 * the clipboard's own content: Ask AI has no "nothing selected" abort to
 * catch a leak, so an unrelated previous clipboard (e.g. a password) reaching
 * the model as if it were the selection is the failure this guards against,
 * and it is worse than the false negative below.
 *
 * Trade-off (intentionally the safe direction, and the mirror image of
 * `getHighlightedText`'s): if the user's actual selection happens to be
 * byte-identical to what was already on their clipboard, this also reports
 * "" — a false negative, context silently omitted. That is the right way
 * round here because context is OPTIONAL for this caller: the cost of the
 * false negative is a missing context block in a rare case, versus silently
 * leaking an unrelated clipboard into an AI request in the common case.
 */
export const getHighlightedTextForOptionalContext = async (): Promise<string> => {
  const { value, changed } = await readSelection();
  return changed ? value : "";
};

export type HighlightedSelectionWithActiveApp = {
  text: string;
  activeApp: ActiveApp | null;
};

/**
 * Combined variant used only by the correction hotkey's ordinary (non-Ask)
 * preset branch (`~/main/keybindings/correction.ts`): ONE `osascript`
 * invocation reads the frontmost app and THEN sends the Cmd-C keystroke, in a
 * single System Events session — replacing the two separate spawns
 * (`getActiveApp()` + `getHighlightedText()`) that used to cost an extra
 * process spawn, plus a second System Events attach and process enumeration,
 * on top of the shared one. The frontmost read happens first inside the
 * script, exactly like the sequential order it replaces, so the ordering
 * guarantee is unchanged.
 *
 * `getActiveApp()` itself (`~/main/accessibility/activeApp`) is untouched and
 * keeps working standalone — PromptGen still calls it separately, since only
 * this hotkey path bundles the two reads.
 *
 * Shares `getHighlightedText`'s STRICT clipboard contract, not
 * `getHighlightedTextForOptionalContext`'s: `text` falls back to the
 * clipboard's own (unchanged) content on a poll timeout/no-op, same as before
 * the change-poll existed, for the same reason `getHighlightedText`'s doc
 * comment explains — this replaces that function's call site in
 * `correction.ts`'s ordinary preset branch, so it must not regress it.
 *
 * `onFrontmostReadAndKeystrokeSent` fires as soon as the script returns,
 * BEFORE the clipboard-change poll: that is the earliest point at which it
 * is still safe to show the overlay spinner (see the ordering comment on
 * `correction.ts`'s hotkey handler and on `getActiveApp`'s own doc
 * comment) — once a FixLang window is on screen, a frontmost read reports
 * FixLang itself and yields null.
 *
 * Ask AI does not use this: `askFlow.ts` never passes app context to
 * `fixGrammar`, so reading the frontmost app for that preset would be a
 * wasted `osascript` round-trip (see `correction.ts`).
 */
export const getHighlightedTextWithActiveApp = async (
  onFrontmostReadAndKeystrokeSent?: () => void,
): Promise<HighlightedSelectionWithActiveApp> => {
  const previousClipboardContent = clipboard.readText();
  const startedAt = Date.now();
  clipboardOperationsInFlight += 1;

  logger.debug("clipboard.copy", "Sending copy keystroke with frontmost-app read", {
    previousLength: previousClipboardContent.length,
    concurrentOps: clipboardOperationsInFlight,
  });

  try {
    // App context is best-effort; the COPY is not. When the combined script
    // fails or hits `ACTIVE_APP_READ_TIMEOUT_MS` (a beachballed frontmost
    // process still answers System Events, just slowly), retry with a plain
    // keystroke rather than failing the transform — a hung lookup must cost
    // only the metadata block, exactly as it did when the lookup was a
    // separate, separately-capped `osascript` call. Re-sending Cmd-C is safe:
    // if the timed-out script had already delivered its keystroke, the second
    // one copies the same selection again.
    let activeApp: ActiveApp | null = null;
    try {
      const stdout = await sendCopyKeystrokeWithActiveAppRead();
      activeApp = parseActiveApp(stdout);
      logActiveAppRead(activeApp, stdout);
    } catch (activeAppError) {
      logger.warn(
        "accessibility.activeApp",
        "Combined frontmost-app read failed; retrying copy without app context",
        {
          error:
            activeAppError instanceof Error
              ? activeAppError.message
              : String(activeAppError),
        },
      );
      await sendCopyKeystroke();
    }

    onFrontmostReadAndKeystrokeSent?.();

    const { value, changed } = await finishClipboardRead(previousClipboardContent);

    logger.debug("clipboard.copy", "Copy keystroke returned", {
      copiedLength: value.length,
      previousLength: previousClipboardContent.length,
      clipboardChanged: changed,
      elapsedMs: Date.now() - startedAt,
    });

    return { text: value, activeApp };
  } catch (error) {
    logCopyKeystrokeFailure(error, startedAt);
    throw toSelectionError(error);
  } finally {
    clipboard.writeText(previousClipboardContent);
    clipboardOperationsInFlight -= 1;
    logger.debug("clipboard.copy", "Previous clipboard restored", {
      elapsedMs: Date.now() - startedAt,
      concurrentOps: clipboardOperationsInFlight,
    });
  }
};

/**
 * Plain Cmd-C, no frontmost-app read, no hardcoded `delay`: the caller polls
 * the clipboard for the change instead (see `finishClipboardRead`).
 */
const sendCopyKeystroke = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const script = `
      tell application "System Events"
        keystroke "c" using command down
      end tell
    `;

    exec(`osascript -e '${script}'`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

/**
 * Reads the frontmost app (name + bundle id) and THEN sends the Cmd-C
 * keystroke, in one `osascript` invocation. The frontmost-app lookup is
 * wrapped in its own AppleScript `try` so a lookup failure (e.g. no process
 * currently reports itself frontmost) cannot prevent the keystroke from
 * firing — best-effort in, best-effort out: `parseActiveApp` already treats
 * an empty/malformed line as "no usable context" on the JS side.
 *
 * The AppleScript `try` covers lookup ERRORS but cannot cover a HANG: a
 * beachballed frontmost process still answers System Events, just very slowly,
 * and `first application process whose frontmost is true` enumerates every
 * process. Because that enumeration now runs BEFORE the keystroke in the same
 * script, an unbounded hang here would block the copy itself — where the old
 * standalone lookup was capped at `ACTIVE_APP_TIMEOUT_MS` and simply degraded
 * to null while the copy went ahead separately. The timeout restores that
 * bound; the caller falls back to a plain `sendCopyKeystroke` so a hung lookup
 * still costs only the app-context block, never the whole transform.
 */
const ACTIVE_APP_READ_TIMEOUT_MS = 1_500;

const sendCopyKeystrokeWithActiveAppRead = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const script = `
      tell application "System Events"
        set frontName to ""
        set frontBundleId to ""
        try
          set frontApp to first application process whose frontmost is true
          set frontName to name of frontApp
          set frontBundleId to bundle identifier of frontApp
        end try
        keystroke "c" using command down
      end tell
      return frontName & tab & frontBundleId
    `;

    exec(
      `osascript -e '${script}'`,
      { timeout: ACTIVE_APP_READ_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
};

export const pasteText = (text: string): Promise<void> => {
  const previousClipboardContent = clipboard.readText();
  const startedAt = Date.now();
  clipboardOperationsInFlight += 1;
  return new Promise((resolve, reject) => {
    clipboard.writeText(text);

    logger.debug("clipboard.paste", "Sending paste keystroke", {
      textLength: text.length,
      previousLength: previousClipboardContent.length,
      concurrentOps: clipboardOperationsInFlight,
    });

    const script = `
      tell application "System Events"
        keystroke "v" using command down
        delay 0.1
      end tell
    `;

    exec(`osascript -e '${script}'`, (error) => {
      clipboardOperationsInFlight -= 1;
      logger.debug("clipboard.paste", "Paste keystroke returned", {
        textLength: text.length,
        restoreAfterMs: Date.now() - startedAt,
        stillOnPasteboard: clipboard.readText() === text,
        failed: error !== null,
        permissionDenied: isKeystrokePermissionDenied(error),
        concurrentOps: clipboardOperationsInFlight,
      });

      if (error) {
        // Same permission-denial detection as `sendCopyKeystroke`/
        // `getHighlightedText` above — `pasteText` synthesizes keystrokes
        // too, so it hits the exact same macOS TCC failure mode.
        reject(
          isKeystrokePermissionDenied(error)
            ? new AccessibilityPermissionError()
            : `Error: ${error.message}`,
        );
        clipboard.writeText(previousClipboardContent);
        return;
      }
      resolve();
      clipboard.writeText(previousClipboardContent);
    });
  });
};

export class StringPrettifier extends String {
  value: string;
  constructor(text: string) {
    super(text);
    this.value = text;
  }

  removeExtraSpaces(): StringPrettifier {
    const cleaned = this.value
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n");

    return new StringPrettifier(cleaned);
  }

  removeEmptyLines(): StringPrettifier {
    const newValue = this.value;
    const linesSplitted = newValue.split("\n");
    const emptyLinesRemoved = linesSplitted.reduce<string[]>((acc, line) => {
      const isEmpty = `${line}`.trim() === "";

      if (isEmpty) {
        if (acc.length === 0 || acc[acc.length - 1] !== "") {
          acc.push("");
        }
      } else {
        acc.push(line);
      }
      return acc;
    }, []);

    return new StringPrettifier(emptyLinesRemoved.join("\n"));
  }
}

/**
 * Polls `clipboard.readText()` until it differs from `oldValue` or `timeout`
 * elapses, returning the new value (or `oldValue` unchanged on timeout).
 * `interval` defaults to 50ms for general callers; `~/utils`'s own selection
 * reads use a tighter ~10ms tick since a pasteboard write from a synthesized
 * Cmd-C typically lands in well under 20ms.
 */
export const waitForClipboardChange = async ({
  timeout = 3 * 1000,
  interval = 50,
  oldValue = clipboard.readText(),
}: {
  timeout?: number;
  interval?: number;
  oldValue?: string;
} = {}): Promise<string> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const newValue = clipboard.readText();
    if (newValue !== oldValue) {
      return newValue;
    }
    await wait(interval);
  }

  return oldValue;
};
