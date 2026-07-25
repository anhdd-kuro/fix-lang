/**
 * @file localeState.ts
 * @description Pure state logic for the renderer i18n runtime, extracted out
 * of `I18nProvider.tsx` so it is unit-testable without React or jsdom (Vitest
 * only collects `.test.ts`, and `@testing-library/react` is not installed).
 *
 * The provider is intentionally "dumb": it resolves the initial locale once,
 * subscribes to the main-process broadcast, and otherwise only reacts to that
 * broadcast. `setLocale` never optimistically flips local state — main
 * persists the value and re-broadcasts it, and that broadcast is the only
 * thing that ever updates `locale` after mount. If main rejects the change
 * (`{ success: false }`), nothing local is touched, so the displayed locale
 * never diverges from what main actually holds.
 */

import { DEFAULT_LOCALE, LOCALE_META, type Locale, type TextDirection } from "~/shared/i18n/registry";

// ---------------------------------------------------------------------------
// State + reducer
// ---------------------------------------------------------------------------

export type LocaleStatus = "loading" | "ready";

export type LocaleState = {
  locale: Locale;
  status: LocaleStatus;
};

export type LocaleAction =
  | { type: "resolved"; locale: Locale }
  | { type: "broadcast"; locale: Locale }
  | { type: "setLocaleRejected" };

/** State before the first `getLocale()` resolves — never rendered translated. */
export const INITIAL_LOCALE_STATE: LocaleState = {
  locale: DEFAULT_LOCALE,
  status: "loading",
};

/**
 * Reducer covering every transition the provider can see:
 *  - `resolved`   — the initial `getLocale()` call finished.
 *  - `broadcast`  — main pushed `locale-changed` (from this window's own
 *    `setLocale` call, another window's, or a future settings sync).
 *  - `setLocaleRejected` — main rejected a `setLocale` request; the state is
 *    returned unchanged (same reference) so it never diverges from main.
 */
export const localeReducer = (state: LocaleState, action: LocaleAction): LocaleState => {
  switch (action.type) {
    case "resolved":
      return { locale: action.locale, status: "ready" };
    case "broadcast":
      return { locale: action.locale, status: "ready" };
    case "setLocaleRejected":
      return state;
  }
};

// ---------------------------------------------------------------------------
// <html> attribute derivation
// ---------------------------------------------------------------------------

export type DocumentLocaleAttrs = {
  lang: Locale;
  dir: TextDirection;
};

/** `document.documentElement.lang` / `.dir` values for a given locale. */
export const documentAttrsForLocale = (locale: Locale): DocumentLocaleAttrs => ({
  lang: locale,
  dir: LOCALE_META[locale].dir,
});

// ---------------------------------------------------------------------------
// Bridge orchestration (pure functions the provider's effects call into)
// ---------------------------------------------------------------------------

/** The subset of `window.electronAPI` the i18n runtime depends on. */
export type LocaleBridge = {
  getLocale: () => Promise<{ locale: Locale }>;
  setLocale: (locale: Locale) => Promise<{ success: boolean; error?: string }>;
  onLocaleChanged: (callback: (locale: Locale) => void) => () => void;
};

/** Resolves the initial locale from the bridge into a `resolved` action. */
export const resolveInitialLocale = async (bridge: LocaleBridge): Promise<LocaleAction> => {
  const { locale } = await bridge.getLocale();
  return { type: "resolved", locale };
};

/**
 * Subscribes to main-process locale broadcasts, dispatching a `broadcast`
 * action for every push. Returns the bridge's own unsubscribe function
 * unmodified so the caller's cleanup (`useEffect` return) tears it down.
 */
export const subscribeToLocaleBroadcasts = (
  bridge: LocaleBridge,
  dispatch: (action: LocaleAction) => void,
): (() => void) =>
  bridge.onLocaleChanged((locale) => {
    dispatch({ type: "broadcast", locale });
  });

/**
 * Requests a locale change via the bridge. On success, does nothing locally —
 * the resulting `locale-changed` broadcast is what updates state. On
 * rejection, dispatches `setLocaleRejected` so state is explicitly confirmed
 * unchanged (and callers can log/surface `result.error` if they want to).
 */
export const requestSetLocale = async (
  bridge: LocaleBridge,
  next: Locale,
  dispatch: (action: LocaleAction) => void,
): Promise<{ success: boolean; error?: string }> => {
  const result = await bridge.setLocale(next);
  if (!result.success) {
    dispatch({ type: "setLocaleRejected" });
  }
  return result;
};
