/**
 * @file locale.ts
 * @description IPC handlers for locale persistence and cross-window sync.
 */
import { BrowserWindow, ipcMain } from "electron";
import {
  syncCorrectionResultWindowLocale,
  syncErrorPopupLocale,
  syncPromptGenWindowLocale,
} from "~/main/webViewWindows";
import { isLocale } from "~/shared/i18n/detect";
import { getLocale, setLocale } from "~/stores/localeStore";
import type { Locale } from "~/shared/i18n/registry";

/**
 * Broadcasts the active locale to every open BrowserWindow, then re-syncs the
 * standalone-titled/HTML-only windows that don't pick up the change on their
 * own: PromptGen and correction-result windows only read their `title` once
 * at construction (creation-cached singletons), and the error popup renders
 * plain HTML with no renderer script listening for `locale-changed`. Mirrors
 * how `broadcastTheme` calls `syncOverlayTheme` / `syncErrorPopupTheme`.
 */
export const broadcastLocale = (locale: Locale): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("locale-changed", locale);
    }
  });
  syncPromptGenWindowLocale();
  syncCorrectionResultWindowLocale();
  syncErrorPopupLocale();
};

/**
 * Sends the current locale to a single window after it finishes loading.
 */
export const syncLocaleToWindow = (webContents: Electron.WebContents): void => {
  const locale = getLocale();
  if (!webContents.isDestroyed()) {
    webContents.send("locale-changed", locale);
  }
};

/**
 * Registers locale-related IPC handlers.
 */
export const registerLocaleHandlers = (): void => {
  ipcMain.handle("get-locale", async () => ({
    locale: getLocale(),
  }));

  ipcMain.handle("set-locale", async (_event, raw: unknown) => {
    if (!isLocale(raw)) {
      return {
        success: false,
        error: "Invalid locale",
      };
    }

    setLocale(raw);
    broadcastLocale(raw);
    return { success: true };
  });
};
