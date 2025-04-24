/**
 * @file mainWindow.ts
 * @description Main window singleton logic for FixLang Electron app.
 * Handles creation, access, and management of the main BrowserWindow.
 */
import path from "node:path";
import { app, BrowserWindow } from "electron";
import appIcon from "../../../resources/icon.ico?asset";
import type { BrowserWindowConstructorOptions } from "electron";

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
    width: 1000,
    height: 900,
    icon: appIcon,
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
      ...options?.webPreferences,
    },
    ...options,
  });
  setMainWindow(win);

  // Set mainWindow to null when the window is closed
  win.on("closed", () => {
    mainWindow = null;
  });

  const rendererPath = path.join(
    __dirname,
    "../renderer/MainWindow/index.html"
  );
  win.loadFile(rendererPath);
  return win;
};

export const initializeMainWindow = () => {
  app.whenReady().then(() => {
    createMainWindow();
  });
  app.on("will-quit", () => {
    destroyMainWindow();
  });
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
