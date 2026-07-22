/**
 * @file theme.ts
 * @description IPC handlers for UI theme persistence and cross-window sync.
 */
import { BrowserWindow, ipcMain } from "electron";
import {
  syncErrorPopupTheme,
  syncOverlayTheme,
} from "~/main/webViewWindows";
import { isThemeId, themeStore, type ThemeId } from "~/stores/themeStore";

/**
 * Broadcasts the active theme to every open BrowserWindow.
 */
export const broadcastTheme = (themeId: ThemeId): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("theme-changed", themeId);
    }
  });
  syncOverlayTheme(themeId);
  syncErrorPopupTheme(themeId);
};

/**
 * Sends the current theme to a single window after it finishes loading.
 */
export const syncThemeToWindow = (webContents: Electron.WebContents): void => {
  const themeId = themeStore.getThemeId();
  if (!webContents.isDestroyed()) {
    webContents.send("theme-changed", themeId);
  }
};

/**
 * Registers theme-related IPC handlers.
 */
export const registerThemeHandlers = (): void => {
  ipcMain.handle("get-theme", async () => ({
    themeId: themeStore.getThemeId(),
  }));

  ipcMain.handle("set-theme", async (_event, raw: unknown) => {
    if (!isThemeId(raw)) {
      return {
        success: false,
        error: "Invalid theme id",
      };
    }

    themeStore.setThemeId(raw);
    broadcastTheme(raw);
    return { success: true };
  });
};
