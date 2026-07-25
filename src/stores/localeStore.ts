/**
 * @file localeStore.ts
 * @description Persists the user's locale preference.
 *
 * The stored value is `null` until the user makes an explicit choice in
 * Settings — that state means "still following the OS locale", not "English".
 * `app.getLocale()` is Electron API, so it is read by the caller (main
 * process) and passed into {@link initializeLocaleFromSystem}; this module
 * never imports `electron` directly, which keeps it importable from vitest.
 */
import Store from "electron-store";
import { normalizeLocale } from "~/shared/i18n/detect";
import { DEFAULT_LOCALE, type Locale } from "~/shared/i18n/registry";

type LocaleStoreSchema = {
  locale: Locale | null;
};

const store = new Store<LocaleStoreSchema>({
  name: "locale",
  defaults: {
    locale: null,
  },
  clearInvalidConfig: true,
});

/**
 * Returns the effective locale.
 *
 * Normalizes whatever is persisted — `null` (never chosen) or garbage left
 * behind by a manual edit / older build — down to {@link DEFAULT_LOCALE}.
 */
export const getLocale = (): Locale => normalizeLocale(store.get("locale", null));

/** Persists the user's explicit locale choice. */
export const setLocale = (locale: Locale): void => {
  store.set("locale", locale);
};

/**
 * One-time system-locale detection.
 *
 * If the user has never chosen a locale, normalizes and persists
 * `systemLocale` (the main process's `app.getLocale()`) and returns the
 * resulting effective locale. If the user already chose one, this is a no-op
 * and the stored choice is returned untouched.
 */
export const initializeLocaleFromSystem = (systemLocale: string): Locale => {
  const stored = store.get("locale", null);
  if (stored !== null) {
    return getLocale();
  }

  const detected = normalizeLocale(systemLocale);
  store.set("locale", detected);
  return detected;
};
