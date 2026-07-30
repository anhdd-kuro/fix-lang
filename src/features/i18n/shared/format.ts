/**
 * @file format.ts
 * @description Locale-aware number, currency, date, and relative-time formatting.
 *
 * Every `Intl.*` constructor is cached per `(locale, options)` pair — the tray
 * window re-renders often, and constructing a fresh `Intl.DateTimeFormat` (or
 * similar) on every row is a measurable cost. `createFormatters` itself is
 * memoized per locale so callers (e.g. the renderer i18n provider) can call it
 * on every render/locale-change without re-building the formatter closures.
 *
 * Invalid input (unparseable dates, `NaN`, `Infinity`) never leaks
 * `"Invalid Date"` / `"NaN"` into the UI — every formatter returns `""`
 * instead. History/logs panels format values that can be `undefined` or
 * malformed once they round-trip through SQLite.
 */

import { enUS, ja, type Locale as DateFnsLocale } from "date-fns/locale";
import { LOCALE_META, type Locale } from "./registry";

/** Anything a caller might reasonably hand us as a point in time. */
export type DateInput = Date | number | string;

export type Formatters = {
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCompactNumber: (value: number) => string;
  /** `currency` defaults to `"USD"`. */
  formatCurrency: (value: number, currency?: string) => string;
  /** `value` is a 0..1 ratio, e.g. `0.42` → `"42%"`. */
  formatPercent: (value: number, fractionDigits?: number) => string;
  formatDate: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: DateInput) => string;
  formatRelativeTime: (value: DateInput, now?: DateInput) => string;
  dateFnsLocale: DateFnsLocale;
};

// ---------------------------------------------------------------------------
// Intl instance cache
// ---------------------------------------------------------------------------

/**
 * Sorts object keys (recursively) so two option objects with the same
 * key/value pairs in different insertion order produce the same cache key.
 */
const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
};

const cacheKey = (locale: Locale, options?: object): string =>
  `${locale}:${JSON.stringify(canonicalize(options ?? {}))}`;

const getOrCreate = <T>(cache: Map<string, T>, key: string, factory: () => T): T => {
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const created = factory();
  cache.set(key, created);
  return created;
};

const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

const getNumberFormat = (
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat =>
  getOrCreate(numberFormatCache, cacheKey(locale, options), () =>
    new Intl.NumberFormat(LOCALE_META[locale].intlTag, options),
  );

const getDateTimeFormat = (
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat =>
  getOrCreate(dateTimeFormatCache, cacheKey(locale, options), () =>
    new Intl.DateTimeFormat(LOCALE_META[locale].intlTag, options),
  );

const getRelativeTimeFormat = (
  locale: Locale,
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat =>
  getOrCreate(relativeTimeFormatCache, cacheKey(locale, options), () =>
    new Intl.RelativeTimeFormat(LOCALE_META[locale].intlTag, options),
  );

// ---------------------------------------------------------------------------
// Safe input coercion
// ---------------------------------------------------------------------------

/** Parses `value` into a valid `Date`, or `null` if it can't be. */
const toValidDate = (value: DateInput): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// ---------------------------------------------------------------------------
// Number / currency / percent
// ---------------------------------------------------------------------------

const formatNumberImpl = (
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string => (Number.isFinite(value) ? getNumberFormat(locale, options).format(value) : "");

const formatCompactNumberImpl = (locale: Locale, value: number): string =>
  Number.isFinite(value)
    ? getNumberFormat(locale, { notation: "compact" }).format(value)
    : "";

const formatCurrencyImpl = (locale: Locale, value: number, currency = "USD"): string =>
  Number.isFinite(value)
    ? getNumberFormat(locale, { style: "currency", currency }).format(value)
    : "";

const formatPercentImpl = (locale: Locale, value: number, fractionDigits = 0): string =>
  Number.isFinite(value)
    ? getNumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value)
    : "";

// ---------------------------------------------------------------------------
// Date / date-time
// ---------------------------------------------------------------------------

const formatDateImpl = (
  locale: Locale,
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string => {
  const date = toValidDate(value);
  return date ? getDateTimeFormat(locale, options).format(date) : "";
};

const formatDateTimeImpl = (_locale: Locale, value: DateInput): string => {
  const date = toValidDate(value);
  if (!date) {
    return "";
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

/**
 * Cascading unit thresholds (seconds → minutes → hours → days → months →
 * years), the standard `Intl.RelativeTimeFormat` "pick a unit" algorithm.
 */
const RELATIVE_TIME_DIVISIONS: readonly {
  amount: number;
  unit: Intl.RelativeTimeFormatUnit;
}[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 30, unit: "day" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

const selectRelativeUnit = (
  deltaSeconds: number,
): { amount: number; unit: Intl.RelativeTimeFormatUnit } => {
  let duration = deltaSeconds;
  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return { amount: Math.round(duration), unit: division.unit };
    }
    duration /= division.amount;
  }
  // Unreachable — the last division's amount is Infinity — kept for type safety.
  return { amount: Math.round(duration), unit: "year" };
};

const formatRelativeTimeImpl = (locale: Locale, value: DateInput, now?: DateInput): string => {
  const target = toValidDate(value);
  const reference = toValidDate(now ?? new Date());
  if (!target || !reference) {
    return "";
  }
  const deltaSeconds = (target.getTime() - reference.getTime()) / 1000;
  const { amount, unit } = selectRelativeUnit(deltaSeconds);
  return getRelativeTimeFormat(locale, { numeric: "auto" }).format(amount, unit);
};

// ---------------------------------------------------------------------------
// date-fns locale mapping
// ---------------------------------------------------------------------------

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  en: enUS,
  ja,
};

/** Maps a FixLang {@link Locale} to its `date-fns/locale` object. */
export const dateFnsLocaleFor = (locale: Locale): DateFnsLocale => DATE_FNS_LOCALES[locale];

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

const formattersCache = new Map<Locale, Formatters>();

/**
 * Test-only escape hatch: peek at the cached `Intl.*` instances (and cache
 * sizes) to prove identical `(locale, options)` calls reuse the same
 * instance. Spying on native `Intl.*` constructors with `vi.spyOn` doesn't
 * work reliably — wrapping them loses the internal slots required for
 * `new`-invoked builtins — so a direct peek is the reliable option here.
 * Not used by production code.
 */
export const __peekFormatCachesForTests = {
  numberFormat: (locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat | undefined =>
    numberFormatCache.get(cacheKey(locale, options)),
  dateTimeFormat: (
    locale: Locale,
    options?: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormat | undefined => dateTimeFormatCache.get(cacheKey(locale, options)),
  relativeTimeFormat: (
    locale: Locale,
    options?: Intl.RelativeTimeFormatOptions,
  ): Intl.RelativeTimeFormat | undefined =>
    relativeTimeFormatCache.get(cacheKey(locale, options)),
  sizes: (): { numberFormat: number; dateTimeFormat: number; relativeTimeFormat: number } => ({
    numberFormat: numberFormatCache.size,
    dateTimeFormat: dateTimeFormatCache.size,
    relativeTimeFormat: relativeTimeFormatCache.size,
  }),
};

/**
 * Test-only escape hatch: clears every memoization cache in this module.
 *
 * The `Intl.*` and formatter-bundle caches are module-level singletons by
 * design (that's the point of them), which means tests that want to prove a
 * cache hit/miss need a way to start from a clean slate instead of depending
 * on suite execution order. Not used by production code.
 */
export const __resetFormatCachesForTests = (): void => {
  numberFormatCache.clear();
  dateTimeFormatCache.clear();
  relativeTimeFormatCache.clear();
  formattersCache.clear();
};

/**
 * Returns the (memoized) formatter bundle for `locale`. Cheap to call
 * repeatedly — the renderer i18n provider may call this on every render.
 */
export const createFormatters = (locale: Locale): Formatters => {
  const cached = formattersCache.get(locale);
  if (cached) {
    return cached;
  }

  const formatters: Formatters = {
    formatNumber: (value, options) => formatNumberImpl(locale, value, options),
    formatCompactNumber: (value) => formatCompactNumberImpl(locale, value),
    formatCurrency: (value, currency) => formatCurrencyImpl(locale, value, currency),
    formatPercent: (value, fractionDigits) => formatPercentImpl(locale, value, fractionDigits),
    formatDate: (value, options) => formatDateImpl(locale, value, options),
    formatDateTime: (value) => formatDateTimeImpl(locale, value),
    formatRelativeTime: (value, now) => formatRelativeTimeImpl(locale, value, now),
    dateFnsLocale: dateFnsLocaleFor(locale),
  };

  formattersCache.set(locale, formatters);
  return formatters;
};
