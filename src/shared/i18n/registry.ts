/**
 * @file registry.ts
 * @description Locale registry: the single place a new language is declared.
 *
 * Adding a language is two edits: append the code to `LOCALE_CODES` and add one
 * `LOCALE_META` entry. Everything else (catalogs, formatters, the language
 * picker) is driven off this table.
 *
 * Deliberately dependency-free — this module is imported by the Electron main
 * process, the preload bridge, and the renderer.
 */

export const LOCALE_CODES = ["en", "ja"] as const;

export type Locale = (typeof LOCALE_CODES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export type TextDirection = "ltr" | "rtl";

export type LocaleMeta = {
  /** Locale code used as the catalog key and persisted value. */
  code: Locale;
  /** Name in English, for docs and debugging. */
  label: string;
  /** Name in the language itself, shown in the language picker. */
  nativeLabel: string;
  /** Writing direction applied to `<html dir>`. */
  dir: TextDirection;
  /** BCP 47 tag handed to `Intl.*` constructors. */
  intlTag: string;
};

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: {
    code: "en",
    label: "English",
    nativeLabel: "English",
    dir: "ltr",
    intlTag: "en-US",
  },
  ja: {
    code: "ja",
    label: "Japanese",
    nativeLabel: "日本語",
    dir: "ltr",
    intlTag: "ja-JP",
  },
};

/** Ordered list of locale metadata, for rendering pickers. */
export const LOCALE_OPTIONS: readonly LocaleMeta[] = LOCALE_CODES.map(
  (code) => LOCALE_META[code],
);
