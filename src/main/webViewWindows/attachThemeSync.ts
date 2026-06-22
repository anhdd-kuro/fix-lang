/**
 * @file attachThemeSync.ts
 * @description Attaches theme sync to a BrowserWindow on load.
 */
import { syncThemeToWindow } from "~/main/ipc/features/theme";
import type { BrowserWindow } from "electron";

/**
 * Sends the current theme whenever the window finishes loading.
 */
export const attachThemeSync = (window: BrowserWindow): void => {
  window.webContents.on("did-finish-load", () => {
    syncThemeToWindow(window.webContents);
  });
};
