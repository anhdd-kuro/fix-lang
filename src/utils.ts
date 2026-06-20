import { exec, execSync } from "child_process";
import { clipboard, dialog, shell } from "electron";

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

export const promptAccessibilityPermission = () => {
  if (process.platform !== "darwin") return;

  const btn = dialog.showMessageBoxSync({
    type: "warning",
    buttons: ["Open Settings", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Accessibility Permission Required",
    message: "FixLang needs Accessibility permission to simulate keystrokes.",
    detail:
      "Please enable accessibility for this app in System Settings > Privacy & Security > Accessibility.",
  });

  if (btn === 0) {
    // Open Accessibility Settings
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    );
  }
};

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const getHighlightedText = async (): Promise<string> => {
  const previousClipboardContent = clipboard.readText();
  try {
    const selectedText = await copyHighlightedText();
    return selectedText;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get highlighted text", { cause: error });
  } finally {
    clipboard.writeText(previousClipboardContent);
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
        reject(`Error: ${error.message}`);
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
