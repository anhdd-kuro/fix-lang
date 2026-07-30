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

/**
 * `clipboard.readText()` yields `""` for an image-only or RTF-only clipboard, so
 * writing that snapshot back would replace content this function never captured
 * and cannot reproduce. Only an *actually empty* clipboard — no flavours at all
 * — is safe to restore from an empty snapshot. A swallowed ⌘C leaves the
 * non-text content intact, and leaving it there is recoverable; blanking it is
 * not.
 */
const isNonTextClipboard = (textSnapshot: string): boolean =>
  textSnapshot.length === 0 && clipboard.availableFormats().length > 0;

export const getHighlightedText = async (): Promise<string> => {
  const previousClipboardContent = clipboard.readText();
  const skipRestore = isNonTextClipboard(previousClipboardContent);
  try {
    const copiedText = await copyHighlightedText();

    // The AppleScript ends in `return the clipboard`, which cannot tell a
    // successful copy from an app that ignored the synthesized ⌘C — in the
    // latter case it hands back whatever was on the clipboard beforehand.
    // Returning that would send the user's *previous* clipboard to an AI
    // provider as if it were their selection, silently and with no error, so an
    // unchanged value is reported as a miss instead (`resolveSelectedText`
    // already routes that to its `clipboardEmpty` refusal).
    //
    // The cost is that a selection identical to what the user just copied now
    // refuses instead of transforming. Accepted deliberately: a visible "no
    // text selected" is recoverable by pressing the hotkey again, whereas
    // transforming the wrong text is not. Distinguishing the two would mean
    // writing a sentinel to the clipboard before the ⌘C, which would destroy
    // exactly the non-text clipboard `skipRestore` above exists to protect.
    if (copiedText === previousClipboardContent.trim()) return "";

    return copiedText;
  } catch (error) {
    // `error` here is the osascript failure (`Command failed: <script>` plus
    // stderr), never the copied text — the selection reaches stdout only, and
    // is deliberately never printed: `src/main/index.ts` patches `console.*`
    // to append to an unrotated `~/.fixlang/log/runtime-*.log` that no
    // redactor reads.
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
    if (!skipRestore) {
      clipboard.writeText(previousClipboardContent);
    }
  }
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

    // Never log `stdout`: it IS the user's selection, and `console.*` is patched
    // in `src/main/index.ts` to append to `~/.fixlang/log/runtime-*.log` —
    // outside `userData`, unrotated, and reached by neither `redactLogMessage`
    // nor `redactLogContext`.
    exec(`osascript -e '${script}'`, (error, stdout) => {
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
