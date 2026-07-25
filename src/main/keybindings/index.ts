import { globalShortcut, BrowserWindow } from "electron";
import { isPromptGenEnabled } from "~/shared/features";
import { registerCorrectionShortcut } from "./correction";
import { registerProfileSwitchShortcut } from "./profileSwitch";
import { registerPromptGenShortcut } from "./promptGen";
import { checkShortcut } from "./utils";
import { getMainWindow } from "../webViewWindows/mainWindow";

const registerDevToolsShortcut = (): void => {
  const ret = globalShortcut.register("F12", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.toggleDevTools();
  });
  checkShortcut(ret);
};

/**
 * Registers global shortcuts for the application.
 * @param mainWindow The main browser window instance.
 */
export const registerHotkeys = (mainWindow: BrowserWindow): void => {
  console.log("Attempting to register hotkeys...");

  registerCorrectionShortcut(mainWindow);
  // Feature tag off => never claim the PromptGen hotkey, so the key stays free
  // for other apps.
  if (isPromptGenEnabled()) {
    registerPromptGenShortcut(mainWindow);
  } else {
    console.log("PromptGen feature disabled at build time; hotkey skipped.");
  }
  registerProfileSwitchShortcut(); // Register the profile switch shortcut
  registerDevToolsShortcut();
};

export const reloadHotkeys = (): void => {
  unregisterHotkeys();

  const mainWindow = getMainWindow();
  if (mainWindow) {
    registerHotkeys(mainWindow);
  }
};

/**
 * Un-registers all global shortcuts.
 */
export const unregisterHotkeys = () => {
  globalShortcut.unregisterAll();
  console.log("All global shortcuts unregistered.");
};
