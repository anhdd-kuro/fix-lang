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
 * Empties the pasteboard so the poll that follows is asking "did the copy put
 * anything there", not "did the pasteboard value change".
 *
 * This is the whole reason the read is trustworthy. Polling for a CHANGE
 * cannot distinguish "nothing was selected" from "the selection is
 * byte-identical to what was already on the clipboard", and the second case is
 * not exotic — copy a paragraph, leave it selected, hit a hotkey, and every
 * caller here saw "unchanged". The strict path then transformed the stale
 * clipboard and the Ask AI path silently dropped the context the user had
 * selected. Against an empty starting value both questions collapse into one,
 * so `changed` below means exactly "the app copied something".
 *
 * Cost, stated plainly: for the length of one read the user's clipboard is
 * empty, and a hard crash inside that window leaves it empty rather than
 * restoring it. `finally` restores on every non-crash path, including throws.
 * Nothing is lost that `clipboard.writeText(previous)` was not already
 * discarding — that restore has always dropped non-text flavours.
 */
const clearClipboardForSelectionRead = (): void => {
  clipboard.clear();
};

/**
 * Polls the now-empty clipboard for CONTENT (via `waitForClipboardChange`)
 * rather than reading the clipboard back from AppleScript itself: selection
 * text can contain tabs/newlines that would be unparseable if bundled into one
 * `osascript` stdout blob alongside app-name/bundle-id, and this is also what
 * lets `getHighlightedText`/`getAskContext`/
 * `getHighlightedTextWithActiveApp` share one "did the copy actually put
 * something on the pasteboard" signal instead of each parsing it differently.
 *
 * Requires `clearClipboardForSelectionRead` to have run first. `value` is what
 * the copy produced, or `""` when the poll timed out with the pasteboard still
 * empty — which now means one unambiguous thing: nothing was copied.
 */
const finishClipboardRead = async (): Promise<{
  value: string;
  changed: boolean;
}> => {
  const value = await waitForClipboardChange({
    oldValue: "",
    interval: CLIPBOARD_POLL_INTERVAL_MS,
    timeout: CLIPBOARD_CHANGE_TIMEOUT_MS,
  });
  return { value, changed: value !== "" };
};

type SelectionRead = {
  /** What the copy produced, or the clipboard snapshot when it produced nothing. */
  value: string;
  /** True when the copy itself produced the value; false when it fell back. */
  changed: boolean;
};

/**
 * Shared body behind `getHighlightedText` and
 * `getAskContext`: snapshots the clipboard, EMPTIES it
 * (see `clearClipboardForSelectionRead`), sends the Cmd-C via
 * `sendCopyKeystroke`, restores the clipboard in `finally` (running on every
 * path for both callers), and maps a revoked Accessibility permission to
 * `AccessibilityPermissionError` — everything the two exported functions need
 * to stay byte-identical on their own error handling. Returns both `value` and
 * `changed` unfiltered; each exported wrapper below decides on its own what an
 * empty read should mean for its caller.
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
    clearClipboardForSelectionRead();
    await sendCopyKeystroke();
    const { value: copied, changed } = await finishClipboardRead();
    // The copy is the preferred source, the clipboard snapshot the fallback.
    // On machines where the synthesized Cmd-C does not reach the frontmost app
    // at all, the fallback is the ONLY source — every read on this developer's
    // machine came back `copied === previous`, i.e. the transform ran on text
    // they had copied by hand. `changed` is what tells the two apart, which is
    // what the pasteboard clearing above buys.
    const value = changed ? copied : previousClipboardContent;

    // `selectionChanged`, NOT `clipboardChanged`: `redactLogContext` blanks any
    // key merely CONTAINING "clipboard", so the older name persisted as
    // "[REDACTED]" and this line could not answer the one question it exists
    // for. Same trap as the `selectionPoll` latency phase.
    logger.debug("clipboard.copy", "Copy keystroke returned", {
      copiedLength: copied.length,
      previousLength: previousClipboardContent.length,
      selectionChanged: changed,
      source: changed ? "selection" : "clipboard",
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
 * below) the correction hotkey's ordinary preset branch. Returns what the copy
 * produced, falling back to the clipboard snapshot when it produced nothing.
 *
 * The fallback is not a nicety. The synthesized Cmd-C does not reach every app
 * — measured across two days of one machine's logs, not one read produced text
 * the clipboard did not already hold — so for a user whose habit is to copy by
 * hand and then press a hotkey, the fallback IS the feature. Removing it turned
 * every transform into "No text selected".
 *
 * What it costs: nothing-selected is served the clipboard's existing content,
 * so a transform can run on text the user did not choose. Callers abort on
 * empty (`!selectedText || !selectedText.trim()` in
 * `correction.ts`/`promptGen.ts`) but cannot tell stale from selected, so the
 * cost is a wasted transform on visible text — not silence. Ask AI, which
 * shows what it attached before sending it, gets the same fallback with the
 * source labelled; see `getAskContext`.
 */
export const getHighlightedText = async (): Promise<string> => {
  const { value } = await readSelection();
  return value;
};

/**
 * Optional-context variant for presets where an empty selection is the NORMAL
 * case (currently only Ask AI). Same read as every other preset — Cmd-C, then
 * the clipboard as fallback — and it returns WHERE the text came from, which
 * is the part that makes the fallback safe here.
 *
 * This used to refuse the fallback outright and report "" whenever the copy
 * produced nothing, on the grounds that Ask AI has no "nothing selected" abort,
 * so an unrelated clipboard (a password) could reach the model as if it were
 * the selection. The reasoning was sound and the conclusion was still wrong,
 * for a reason the comment never checked: the copy fails far more often than it
 * was assumed to, so refusing the fallback did not protect a working feature —
 * it removed the only source of context the feature ever had, on every press.
 *
 * What replaces the refusal is not a weaker rule but a different one. Unlike a
 * transform, Ask AI puts its context on screen in a window the user must type
 * into and submit; labelled by source and removable, a stale clipboard is an
 * offer they can see and decline rather than a leak they cannot. `""` still
 * means no context at all: an empty clipboard and a failed copy attach nothing.
 */
export type AskContext = {
  text: string;
  source: "selection" | "clipboard";
};

export const getAskContext = async (): Promise<AskContext> => {
  const { value, changed } = await readSelection();
  return { text: value, source: changed ? "selection" : "clipboard" };
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
 * Shares `getHighlightedText`'s clipboard contract: the pasteboard is emptied
 * before the copy so the two sources can be told apart, `text` is what the copy
 * produced, and the clipboard snapshot stands in when it produced nothing. See
 * `getHighlightedText`'s doc comment for why that fallback is load-bearing.
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
    // Before the script, not after: the keystroke it sends is the thing whose
    // result the poll below reads, so the pasteboard has to already be empty
    // when it fires.
    clearClipboardForSelectionRead();

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

    const { value: copied, changed } = await finishClipboardRead();
    const value = changed ? copied : previousClipboardContent;

    // `selectionChanged`, not `clipboardChanged` — see `readSelection`.
    logger.debug("clipboard.copy", "Copy keystroke returned", {
      copiedLength: copied.length,
      previousLength: previousClipboardContent.length,
      selectionChanged: changed,
      source: changed ? "selection" : "clipboard",
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
