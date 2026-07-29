import { exec, execSync } from "child_process";
import { clipboard, dialog, shell } from "electron";
import { isKeystrokePermissionDenied } from "~/main/accessibility/keystrokePermission";
import { AccessibilityPermissionError } from "~/main/notifications/error";

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

type SelectionRead = {
  text: string;
  previousClipboardContent: string;
};

/**
 * Shared body behind `getHighlightedText` and
 * `getHighlightedTextForOptionalContext`: snapshots the clipboard, sends the
 * Cmd-C via `copyHighlightedText`, restores the clipboard in `finally`
 * (running on every path for both callers), and maps a revoked Accessibility
 * permission to `AccessibilityPermissionError` — everything the two exported
 * functions need to stay byte-identical on their own error handling.
 */
const readSelection = async (): Promise<SelectionRead> => {
  const previousClipboardContent = clipboard.readText();
  try {
    const text = await copyHighlightedText();
    return { text, previousClipboardContent };
  } catch (error) {
    console.error(error);
    // A revoked Accessibility permission is a distinct, actionable condition
    // (see `~/main/accessibility/keystrokePermission`) — pass it through as
    // `AccessibilityPermissionError` instead of burying it in the generic
    // wrapper below, whose message says nothing about permissions.
    if (isKeystrokePermissionDenied(error)) {
      throw new AccessibilityPermissionError();
    }
    throw new Error("Failed to get highlighted text", { cause: error });
  } finally {
    clipboard.writeText(previousClipboardContent);
  }
};

export const getHighlightedText = async (): Promise<string> => {
  const { text } = await readSelection();
  return text;
};

/**
 * Optional-context variant for presets where an empty selection is the
 * NORMAL case (currently only Ask AI) — unlike the six polish presets, which
 * abort outright when `getHighlightedText` comes back empty, so a stale
 * clipboard reaching them was harmless.
 *
 * `copyHighlightedText` sends Cmd-C via AppleScript and then reads back
 * `the clipboard`. With nothing selected, that keystroke is a no-op, so the
 * read returns whatever was ALREADY on the clipboard — indistinguishable
 * from a real selection unless we compare against the pre-copy snapshot.
 * This reports "" whenever the read did not change the clipboard, instead of
 * handing back the user's unrelated previous clipboard content as if it were
 * their selection.
 *
 * Both sides are trimmed before comparing, and that is load-bearing:
 * `copyHighlightedText` returns `stdout.trim()` while the snapshot is the raw
 * clipboard, so comparing them directly never matches whenever the clipboard
 * content has leading/trailing whitespace — and a line copied out of a
 * password manager, a terminal or an editor almost always ends in "\n". That
 * asymmetry defeated the guard entirely for exactly the values it exists to
 * protect.
 *
 * Trade-off (intentionally the safe direction): if the user's actual
 * selection happens to be byte-identical to what was already on their
 * clipboard, this also reports "" — a false negative, context silently
 * omitted. That is the right way round here because context is OPTIONAL for
 * this caller: the cost of the false negative is a missing context block in
 * a rare case, versus silently leaking an unrelated clipboard (e.g. a
 * password) into an AI request in the common case.
 */
export const getHighlightedTextForOptionalContext = async (): Promise<string> => {
  const { text, previousClipboardContent } = await readSelection();
  return text === previousClipboardContent.trim() ? "" : text;
};

const copyHighlightedText = () => {
  return new Promise<string>((resolve, reject) => {
    const script = `
      tell application "System Events"
        delay 0.1
        keystroke "c" using command down
        delay 0.1
      end tell
      return the clipboard
    `;

    exec(`osascript -e '${script}'`, (error, stdout) => {
      console.log(`🚀 \n - exec \n - stdout:`, stdout);
      if (error) {
        reject(`Error: ${error.message}`);
        return;
      }
      resolve(stdout.trim());
    });
  });
};

export const pasteText = (text: string): Promise<void> => {
  const previousClipboardContent = clipboard.readText();
  return new Promise((resolve, reject) => {
    clipboard.writeText(text);
    const script = `
      tell application "System Events"
        keystroke "v" using command down
        delay 0.1
      end tell
    `;

    exec(`osascript -e '${script}'`, (error) => {
      if (error) {
        // Same permission-denial detection as `copyHighlightedText`/
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

export const waitForClipboardChange = async ({
  timeout = 3 * 1000,
  oldValue = clipboard.readText(),
}: {
  timeout?: number;
  oldValue?: string;
} = {}): Promise<string> => {
  const start = Date.now();
  console.log("Waiting for clipboard change!");
  console.log("Old value:", oldValue);
  while (Date.now() - start < timeout) {
    const newValue = clipboard.readText();
    if (newValue !== oldValue) {
      console.log(`Total time taken: ${Date.now() - start}ms`);
      return newValue;
    }
    await wait(50);
  }

  console.log(
    `No clipboard changes detected. Total time taken: ${Date.now() - start}ms`
  );
  return oldValue;
};
