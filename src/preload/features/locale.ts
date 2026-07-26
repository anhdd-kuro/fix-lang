/**
 * Locale-related preload functionality.
 */
import { ipcRenderer } from "electron";
import { isLocale } from "~/shared/i18n/detect";
import type { Locale } from "~/shared/i18n/registry";

export const localeFeature = {
  getLocale: (): Promise<{ locale: Locale }> => ipcRenderer.invoke("get-locale"),

  // Validated even though the param is typed `Locale`: the type only
  // constrains TypeScript call sites, and the renderer is untrusted at runtime.
  // Main keeps its own `isLocale` check as defense in depth.
  setLocale: (locale: Locale): Promise<{ success: boolean; error?: string }> => {
    if (!isLocale(locale)) {
      return Promise.resolve({ success: false, error: "Invalid locale" });
    }
    return ipcRenderer.invoke("set-locale", locale);
  },

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
