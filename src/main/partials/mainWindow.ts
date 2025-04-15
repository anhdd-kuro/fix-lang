/**
 * @file mainWindow.ts
 * @description Main window singleton logic for FixLang Electron app.
 * Handles creation, access, and management of the main BrowserWindow.
 */
import appIcon from "../../../resources/icon.ico?asset";
import { app, BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;

/**
 * Returns the singleton main window instance.
 * @returns {BrowserWindow | null}
 */
export const getMainWindow = (): BrowserWindow | null => mainWindow;

/**
 * Sets the singleton main window instance.
 * @param {BrowserWindow} win - The BrowserWindow instance to set as main.
 */
export const setMainWindow = (win: BrowserWindow) => {
  mainWindow = win;
};

/**
 * Creates the main BrowserWindow and sets it as the singleton instance.
 * @param {BrowserWindowConstructorOptions} options - Optional window options override.
 * @returns {BrowserWindow} The created main window instance.
 */
export const createMainWindow = (
  options?: BrowserWindowConstructorOptions
): BrowserWindow => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    icon: appIcon,
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...options?.webPreferences,
    },
    ...options,
  });
  setMainWindow(win);
  return win;
};

/**
 * Destroys and clears the main window reference.
 */
export const destroyMainWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  mainWindow = null;
};
