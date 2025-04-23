import { globalShortcut, BrowserWindow } from "electron";
import { registerCorrectionShortcut } from "./correction";
import { registerPromptGenShortcut } from "./promptGen";
import { registerSummarizeShortcut } from "./summarize";
import { registerTranslateShortcut } from "./translation";
import { checkShortcut } from "./utils";

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
  registerTranslateShortcut(mainWindow);
  registerSummarizeShortcut(mainWindow);
  registerPromptGenShortcut(mainWindow);
  registerDevToolsShortcut();
};

/**
 * Un-registers all global shortcuts.
 */
export const unregisterHotkeys = () => {
  globalShortcut.unregisterAll();
  console.log("All global shortcuts unregistered.");
};
