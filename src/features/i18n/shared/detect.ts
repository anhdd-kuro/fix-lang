/**
 * @file detect.ts
 * @description Turns an arbitrary locale-ish string into a supported `Locale`.
 *
 * Used for both system detection (`app.getLocale()` in the main process) and
 * validating persisted / IPC-supplied values. Never throws, never returns
 * `undefined` — unsupported input degrades to `DEFAULT_LOCALE`.
 */

import { DEFAULT_LOCALE, LOCALE_CODES, type Locale } from "./registry";

/** Narrow an unknown value to a supported locale code. */
export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALE_CODES as readonly string[]).includes(value);

/**
 * Normalizes a raw locale tag to a supported locale.
 *
 * Handles case (`"JA"`), region subtags (`"ja-JP"`, `"en_US"`), and garbage
 * (`""`, `null`, numbers) by falling back to {@link DEFAULT_LOCALE}.
 */
export const normalizeLocale = (raw: unknown): Locale => {
  if (typeof raw !== "string") {
    return DEFAULT_LOCALE;
  }

  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : DEFAULT_LOCALE;
};
