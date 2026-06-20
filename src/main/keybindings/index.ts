import { globalShortcut, BrowserWindow } from "electron";
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
  registerPromptGenShortcut(mainWindow);
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
