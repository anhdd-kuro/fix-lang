import { exec, execSync } from "child_process";
import { clipboard, dialog, shell } from "electron";
import { isKeystrokePermissionDenied } from "~/main/accessibility/keystrokePermission";
import { logger } from "~/main/logging/logService";
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

let clipboardOperationsInFlight = 0;

export const getHighlightedText = async (): Promise<string> => {
  const previousClipboardContent = clipboard.readText();
  const startedAt = Date.now();
  clipboardOperationsInFlight += 1;

  logger.debug("clipboard.copy", "Sending copy keystroke", {
    previousLength: previousClipboardContent.length,
    concurrentOps: clipboardOperationsInFlight,
  });

  try {
    const selectedText = await copyHighlightedText();

    logger.debug("clipboard.copy", "Copy keystroke returned", {
      copiedLength: selectedText.length,
      previousLength: previousClipboardContent.length,
      matchedPreviousValue: selectedText === previousClipboardContent,
      elapsedMs: Date.now() - startedAt,
    });

    return selectedText;
  } catch (error) {
    logger.warn("clipboard.copy", "Copy keystroke failed", {
      elapsedMs: Date.now() - startedAt,
      permissionDenied: isKeystrokePermissionDenied(error),
    });
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
    clipboardOperationsInFlight -= 1;
    logger.debug("clipboard.copy", "Previous clipboard restored", {
      elapsedMs: Date.now() - startedAt,
      concurrentOps: clipboardOperationsInFlight,
    });
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

    exec(`osascript -e '${script}'`, (error, stdout) => {
      logger.debug("clipboard.copy", "osascript copy stdout received", {
        stdoutLength: stdout.length,
      });
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
