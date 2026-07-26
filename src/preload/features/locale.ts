/**
 * Locale-related preload functionality.
 */
import { ipcRenderer } from "electron";
import { isLocale } from "~/shared/i18n/detect";
import type { Locale } from "~/shared/i18n/registry";

export const localeFeature = {
  getLocale: (): Promise<{ locale: Locale }> => ipcRenderer.invoke("get-locale"),

  // Validated here even though the param is typed `Locale` — the type only
  // constrains TypeScript call sites; the renderer is untrusted at runtime
  // (see src/preload/features/api.ts's isProviderConnectInput/isProviderId for
  // the same pattern). Main (`src/main/ipc/features/locale.ts`) keeps its own
  // `isLocale` check unchanged as defense in depth, not replaced by this one.
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
