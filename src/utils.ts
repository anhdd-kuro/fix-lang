import { execSync } from "child_process";
import { clipboard, dialog, shell, Notification } from "electron";

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
  let text = "";

  await restoreClipboardAfterAction(async () => {
    text = await copyHighlightedText();
    return;
  });

  return text;
};

export const copyHighlightedText = async () => {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      execSync(
        `osascript -e '
          delay 0.1 -- wait for previous keybinding action to complete
          tell application "System Events" -- get process name of frontmost app
            keystroke "c" using command down -- simulate Cmd+C
            keystroke "c" using command down -- simulate Cmd+C -- Do twice to make sure clipboard is updated
            delay 0.2
          end tell
        '`
      );
    } else if (platform === "win32") {
      execSync(
        'powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\\"^c\\")"'
      );
    } else {
      execSync(`xdotool key ctrl+c`);
    }
    return clipboard.readText();
  } catch (err) {
    console.error("❌ Error getting selected text:", err);
    new Notification({
      title: "Error",
      body: "Failed to get the selected text. Please try again.",
      urgency: "critical",
    }).show();
    return "";
  }
};

const restoreClipboardAfterAction = async (
  action: () => void | Promise<void>
) => {
  const previousClipboardContent = clipboard.readText();
  try {
    await action();
  } catch (err) {
    console.error("❌ Error during action:", err);
    new Notification({
      title: "Error",
      body: "Failed to perform the action.Please try again.",
      urgency: "critical",
    }).show();
  } finally {
    clipboard.writeText(previousClipboardContent);
  }
};

export const pasteText = async (text: string): Promise<void> => {
  await restoreClipboardAfterAction(() => {
    clipboard.writeText(text);
    const platform = process.platform;

    try {
      if (platform === "darwin") {
        execSync(
          `osascript -e '
            delay 0.1
            tell application "System Events" -- get process name of frontmost app
              keystroke "v" using {command down} -- simulate Cmd+V
            end tell
            delay 0.1
          '`
        );
      } else if (platform === "win32") {
        execSync(
          'powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys("^v")"'
        );
      } else {
        execSync(`xdotool key ctrl+v`);
      }
    } catch (err) {
      console.error("❌ Error pasting text:", err);
      new Notification({
        title: "Error",
        body: "Failed to paste text. Please try again.",
        urgency: "critical",
      }).show();
    }
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
