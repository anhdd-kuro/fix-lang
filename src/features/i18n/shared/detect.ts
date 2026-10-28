/**
 * @file detect.ts
 * @description Turns an arbitrary locale-ish string into a supported `Locale`.
 *
 * Used for both system detection (`app.getLocale()` in the main process) and
 * validating persisted / IPC-supplied values. Never throws, never returns
 * `undefined` — unsupported input degrades to `DEFAULT_LOCALE`.
 */

import { z } from "zod";
import { schemaGuard } from "~/features/core/shared/schemaGuard";
import { DEFAULT_LOCALE, LOCALE_CODES, type Locale } from "./registry";

/** Exactly one of {@link LOCALE_CODES}; a boxed string is not one. */
export const LocaleSchema = z.enum(LOCALE_CODES);

/** Narrow a value of any type to a supported locale code. */
export const isLocale = schemaGuard(LocaleSchema);

/**
 * Normalizes a raw locale tag to a supported locale.
 *
 * Handles case (`"JA"`), region subtags (`"ja-JP"`, `"en_US"`), and garbage
 * (`""`, `null`, numbers) by falling back to {@link DEFAULT_LOCALE}.
 */
export const normalizeLocale = <Raw>(raw: Raw): Locale => {
  const tag = z.string().safeParse(raw);
  if (!tag.success) {
    return DEFAULT_LOCALE;
  }

  const base = tag.data.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : DEFAULT_LOCALE;
};
