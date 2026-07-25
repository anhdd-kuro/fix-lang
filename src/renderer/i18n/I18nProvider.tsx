/**
 * @file I18nProvider.tsx
 * @description Renderer i18n context: resolves the persisted locale on mount,
 * subscribes to the main-process `locale-changed` broadcast, and syncs
 * `<html lang dir>`. Mirrors the shape of `useTheme.ts` (load once, subscribe,
 * apply to the document) but exposes its value through context instead of a
 * standalone hook, since `t`/formatters need to be shared identically across
 * an entire window's component tree rather than recomputed per call site.
 *
 * All branching state logic lives in `localeState.ts` so it is unit-testable
 * without React — this file is a thin wiring shell (effects + memoization
 * only), per the project's Vitest constraint (`.tsx` files are not collected).
 */

import React, { createContext, useCallback, useEffect, useMemo, useReducer } from "react";
import { createFormatters, type Formatters } from "~/shared/i18n/format";
import { LOCALE_META, type Locale, type TextDirection } from "~/shared/i18n/registry";
import { createTranslator, type Translator } from "~/shared/i18n/translate";
import {
  documentAttrsForLocale,
  INITIAL_LOCALE_STATE,
  localeReducer,
  requestSetLocale,
  resolveInitialLocale,
  subscribeToLocaleBroadcasts,
  type LocaleBridge,
} from "./localeState";

export type I18nContextValue = Formatters & {
  locale: Locale;
  t: Translator;
  dir: TextDirection;
  /**
   * Requests a locale change. Resolves once main has responded — it does
   * NOT set local state itself; the resulting `locale-changed` broadcast
   * (handled internally by the provider) is what updates `locale`. A
   * rejected request (`{ success: false }`) leaves the current locale as-is.
   */
  setLocale: (next: Locale) => Promise<void>;
};

/** `null` outside `<I18nProvider>`; see `useI18n.ts` for the consumer guard. */
export const I18nContext = createContext<I18nContextValue | null>(null);

type I18nProviderProps = {
  children: React.ReactNode;
};

/**
 * Wraps a window's root component. Renders nothing until the initial locale
 * resolves, so there is no EN -> JA flash on windows whose persisted locale
 * is Japanese.
 */
export const I18nProvider: React.FC<I18nProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(localeReducer, INITIAL_LOCALE_STATE);

  // `window.electronAPI` satisfies `LocaleBridge` structurally; typed as such
  // so the effect body only ever depends on the pure, testable functions in
  // `localeState.ts`, not the global directly.
  const bridge: LocaleBridge = window.electronAPI;

  useEffect(() => {
    let cancelled = false;

    void resolveInitialLocale(bridge).then((action) => {
      if (!cancelled) {
        dispatch(action);
      }
    });

    const unsubscribe = subscribeToLocaleBroadcasts(bridge, dispatch);

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `bridge` is `window.electronAPI`, a stable global; re-subscribing per render would drop/re-add the IPC listener for no benefit.
  }, []);

  useEffect(() => {
    const { lang, dir } = documentAttrsForLocale(state.locale);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [state.locale]);

  const setLocale = useCallback(
    async (next: Locale): Promise<void> => {
      await requestSetLocale(bridge, next, dispatch);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same stable-global rationale as above.
    [],
  );

  // Recomputed only when `locale` (or the stable `setLocale`) changes, so a
  // re-render triggered by unrelated state elsewhere in the tree does not
  // rebuild the translator/formatters — the tray window re-renders often.
  const value = useMemo<I18nContextValue>(() => {
    const formatters = createFormatters(state.locale);
    return {
      ...formatters,
      locale: state.locale,
      t: createTranslator(state.locale),
      dir: LOCALE_META[state.locale].dir,
      setLocale,
    };
  }, [state.locale, setLocale]);

  if (state.status === "loading") {
    // Avoid an EN -> JA flash: render nothing until the first locale resolves.
    return null;
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};
