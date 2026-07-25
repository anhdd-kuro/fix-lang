/**
 * @file translate.ts
 * @description Pure, locale-aware string lookup: plural selection → fallback
 * chain → `{token}` interpolation. No Electron or React imports so it runs
 * unmodified in the main process, the preload bridge, the renderer, and vitest.
 *
 * Resolution order for `t(key, params)`:
 *   1. Plural selection — when `params.count` is a finite number, pick the CLDR
 *      category via `Intl.PluralRules` and try `${key}_${category}` first,
 *      then `${key}_other`, then the bare `key`. Never hardcodes a language
 *      list; the category set is whatever `Intl.PluralRules` returns for the
 *      locale's `intlTag`.
 *   2. Fallback chain — active-locale catalog → English catalog → the key
 *      string itself. Never returns `undefined`, `null`, or `""`.
 *   3. Interpolation — `{token}` occurrences are replaced from `params`;
 *      numbers are stringified with `String(value)`.
 *
 * Dev-only diagnostics warn once per missing key and once per unreplaced
 * `{token}`, de-duplicated via module-level `Set`s so a re-rendering tray does
 * not spam the console. `resetTranslatorDiagnostics()` clears them for tests.
 */

import { CATALOGS, type TranslationKey } from "./locales";
import { LOCALE_META, type Locale } from "./registry";

/** Values interpolated into `{token}` placeholders. */
export type TranslateParams = Record<string, string | number>;

/**
 * Base key of every plural translation key, derived from the `_other`
 * variant that every plural key must define. Resolves to `never` until the
 * catalog defines its first plural key (the seeded Chunk 1 catalog only has
 * `common.*` keys).
 */
export type PluralBaseKey = TranslationKey extends infer Key
  ? Key extends `${infer Base}_other`
    ? Base
    : never
  : never;

/** Every key a call site may pass to `t()` — full keys and plural bases. */
export type TKey = TranslationKey | PluralBaseKey;

/** `t(key, params)` — see module doc for the full resolution order. */
export type Translator = (key: TKey, params?: TranslateParams) => string;

/** Catalog shape accepted by {@link createTranslator}; matches `CATALOGS`. */
type CatalogSource = Record<Locale, Partial<Record<TranslationKey, string>>>;

const missingKeyWarnings = new Set<string>();
const missingParamWarnings = new Set<string>();

/**
 * True outside production. The renderer runs with `contextIsolation` and no
 * Node integration, so `process` may not exist there — guard its presence
 * before touching `process.env`.
 */
const isDevDiagnostics = (): boolean =>
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";

const warnOnce = (seen: Set<string>, dedupeKey: string, message: string): void => {
  if (!isDevDiagnostics() || seen.has(dedupeKey)) {
    return;
  }
  seen.add(dedupeKey);
  console.warn(message);
};

/** Clears de-duplicated warning state. Used by tests between assertions. */
export const resetTranslatorDiagnostics = (): void => {
  missingKeyWarnings.clear();
  missingParamWarnings.clear();
};

const pluralCategory = (locale: Locale, count: number): string =>
  new Intl.PluralRules(LOCALE_META[locale].intlTag).select(count);

/** Ordered lookup candidates: `${key}_${category}` → `${key}_other` → `key`. */
const buildCandidates = (
  locale: Locale,
  key: TKey,
  count: number | undefined,
): string[] => {
  if (count === undefined) {
    return [key];
  }
  const category = pluralCategory(locale, count);
  const candidates = [`${key}_${category}`];
  if (category !== "other") {
    candidates.push(`${key}_other`);
  }
  candidates.push(key);
  return candidates;
};

const lookup = (
  catalog: Partial<Record<TranslationKey, string>>,
  candidates: readonly string[],
): string | undefined => {
  for (const candidate of candidates) {
    // why: candidates are built from runtime string concatenation
    // (`${key}_${category}`), so they cannot be narrowed to the literal
    // `TranslationKey` union at compile time. The lookup stays safe because
    // it only ever yields `string | undefined`, never executes untrusted code.
    const value = catalog[candidate as TranslationKey];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const resolveTemplate = (
  locale: Locale,
  key: TKey,
  count: number | undefined,
  catalogs: CatalogSource,
): string => {
  const candidates = buildCandidates(locale, key, count);

  const active = lookup(catalogs[locale], candidates);
  if (active !== undefined) {
    return active;
  }

  const english = lookup(catalogs.en, candidates);
  if (english !== undefined) {
    if (locale !== "en") {
      warnOnce(
        missingKeyWarnings,
        `${locale}:${key}`,
        `[i18n] "${key}" is missing for locale "${locale}"; falling back to English.`,
      );
    }
    return english;
  }

  warnOnce(
    missingKeyWarnings,
    `${locale}:${key}:absent`,
    `[i18n] "${key}" is missing from every catalog; rendering the key itself.`,
  );
  return key;
};

const interpolate = (
  template: string,
  params: TranslateParams | undefined,
  locale: Locale,
  key: TKey,
): string => {
  const values = params ?? {};
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, token)) {
      warnOnce(
        missingParamWarnings,
        `${locale}:${key}:${token}`,
        `[i18n] Missing param "${token}" for key "${key}".`,
      );
      return match;
    }
    return String(values[token]);
  });
};

const toFiniteCount = (params: TranslateParams | undefined): number | undefined => {
  const count = params?.count;
  return typeof count === "number" && Number.isFinite(count) ? count : undefined;
};

/**
 * Builds a `t()` function bound to `locale`.
 *
 * The optional second argument overrides the catalog source. Production call
 * sites always use the default `CATALOGS`; tests inject fixture catalogs so
 * plural/fallback edge cases can be covered without editing the frozen locale
 * JSON files (the seeded catalog only has `common.*` keys).
 */
export const createTranslator = (
  locale: Locale,
  catalogs: CatalogSource = CATALOGS,
): Translator => {
  return (key: TKey, params?: TranslateParams): string => {
    const count = toFiniteCount(params);
    const template = resolveTemplate(locale, key, count, catalogs);
    return interpolate(template, params, locale, key);
  };
};
