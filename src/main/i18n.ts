/**
 * @file i18n.ts
 * @description Main-process translator access. The main process has no React
 * context, so it cannot reuse the renderer's `I18nProvider`. Every user-facing
 * string built in `main/**` (notifications, window titles) goes through
 * {@link mainT} / {@link mainFormatters} instead.
 *
 * Design note — why no cross-file wiring into `set-locale`:
 * `ipc/features/locale.ts` (already committed) is off-limits for this chunk,
 * so `refreshMainLocale()` cannot be called from its `set-locale` handler.
 * Instead, `mainT`/`mainFormatters` re-read `localeStore.getLocale()` — a
 * cheap in-memory `electron-store` read — on every call, and only cache the
 * built `Translator`/`Formatters` pair keyed by that locale value. If the
 * locale changed since the last call, the cache key no longer matches and a
 * fresh pair is built; if it's unchanged, the cached pair is reused. This
 * makes correctness depend only on `getLocale()` being cheap and side-effect
 * free (it is), not on some other module remembering to call back into this
 * one. `refreshMainLocale()` is kept as an explicit, cheap escape hatch (e.g.
 * for tests) that forces the next call to rebuild regardless.
 *
 * Kept import-cycle-free and renderer-free: the main bundle is CJS (`.cjs`)
 * on Electron 43, and a cycle or a renderer import here breaks the build.
 */
import { createFormatters, type Formatters } from "~/shared/i18n/format";
import {
  createTranslator,
  type TKey,
  type TranslateParams,
  type Translator,
} from "~/shared/i18n/translate";
import { getLocale } from "~/stores/localeStore";
import type { Locale } from "~/shared/i18n/registry";

type MainI18nCache = {
  locale: Locale;
  translator: Translator;
  formatters: Formatters;
};

let cache: MainI18nCache | null = null;

const ensureCache = (): MainI18nCache => {
  const locale = getLocale();
  if (cache && cache.locale === locale) {
    return cache;
  }
  const next: MainI18nCache = {
    locale,
    translator: createTranslator(locale),
    formatters: createFormatters(locale),
  };
  cache = next;
  return next;
};

/** `t(key, params)` for the main process. See module doc for cache behavior. */
export const mainT = (key: TKey, params?: TranslateParams): string =>
  ensureCache().translator(key, params);

/** Locale-aware number/date/currency formatters for the main process. */
export const mainFormatters = (): Formatters => ensureCache().formatters;

/**
 * Drops the cached translator/formatters pair. Not required for correctness
 * (see module doc) — kept as an explicit forced-refresh hook for tests and
 * any future call site that wants one.
 */
export const refreshMainLocale = (): void => {
  cache = null;
};
