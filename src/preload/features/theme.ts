/**
 * Theme-related preload functionality.
 */
import { ipcRenderer } from "electron";
import type { ThemeId } from "~/stores/themeIds";

export const themeFeature = {
  getTheme: (): Promise<{ themeId: ThemeId }> =>
    ipcRenderer.invoke("get-theme"),

  setTheme: (
    themeId: ThemeId,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-theme", themeId),

  onThemeChanged: (callback: (themeId: ThemeId) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, themeId: ThemeId) => {
      callback(themeId);
    };
    ipcRenderer.on("theme-changed", listener);
    return () => {
      ipcRenderer.removeListener("theme-changed", listener);
    };
  },
};

export type ThemeFeature = typeof themeFeature;
