/**
 * Locale-related preload functionality.
 */
import { ipcRenderer } from "electron";
import type { Locale } from "~/shared/i18n/registry";

export const localeFeature = {
  getLocale: (): Promise<{ locale: Locale }> => ipcRenderer.invoke("get-locale"),

  setLocale: (locale: Locale): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-locale", locale),

  onLocaleChanged: (callback: (locale: Locale) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, locale: Locale) => {
      callback(locale);
    };
    ipcRenderer.on("locale-changed", listener);
    return () => {
      ipcRenderer.removeListener("locale-changed", listener);
    };
  },
};

export type LocaleFeature = typeof localeFeature;
