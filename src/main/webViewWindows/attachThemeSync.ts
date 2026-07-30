/**
 * @file attachThemeSync.ts
 * @description Attaches theme + locale sync to a BrowserWindow on load.
 */
import { syncLocaleToWindow } from "~/features/i18n/main/locale";
import { syncThemeToWindow } from "~/features/theme/main/theme";
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
