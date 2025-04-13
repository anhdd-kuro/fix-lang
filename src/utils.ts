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

const copyHighlightedText = async () => {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      execSync(
        `osascript -e '
          tell application "System Events" -- get process name of frontmost app
            keystroke "c" using {command down} -- simulate Cmd+C
          end tell
          delay 0.3
        '`
      );
    } else if (platform === "win32") {
      execSync(
        'powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\\"^c\\")"'
      );
    } else {
      execSync(`xdotool key ctrl+c`);
    }

    const newText = clipboard.readText();
    console.log("📋 New clipboard text:", newText);

    return newText;
  } catch (err) {
    console.error("❌ Error getting selected text:", err);
    new Notification({
      title: "Error",
      body: "Failed to get selected text. Please try again.",
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
      body: "Failed to perform action. Please try again.",
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
            tell application "System Events" -- get process name of frontmost app
              keystroke "v" using {command down} -- simulate Cmd+V
            end tell
            delay 0.3
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
