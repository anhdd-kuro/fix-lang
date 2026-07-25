/**
 * @file attachThemeSync.ts
 * @description Attaches theme + locale sync to a BrowserWindow on load.
 */
import { syncLocaleToWindow } from "~/main/ipc/features/locale";
import { syncThemeToWindow } from "~/main/ipc/features/theme";
import type { BrowserWindow } from "electron";

/**
 * Sends the current theme and locale whenever the window finishes loading, so
 * the tray, PromptGen, and result windows are never a locale/theme behind.
 */
export const attachThemeSync = (window: BrowserWindow): void => {
  window.webContents.on("did-finish-load", () => {
    syncThemeToWindow(window.webContents);
    syncLocaleToWindow(window.webContents);
  });
};
