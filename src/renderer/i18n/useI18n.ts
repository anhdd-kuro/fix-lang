/**
 * @file useI18n.ts
 * @description Consumer hook for the renderer i18n runtime. Thin — all state
 * logic lives in `I18nProvider.tsx` / `localeState.ts`; this just reads the
 * context and fails loudly when a component forgets to mount the provider.
 */

import { useCallback, useContext, useMemo } from "react";
import {
  resolveLabel,
  resolveMessage,
  type Label,
  type Message,
} from "~/features/i18n/shared/message";
import { I18nContext, type I18nContextValue } from "./I18nProvider";

/**
 * `I18nContextValue` plus the two descriptor-resolving helpers the dashboard
 * aggregation layer needs (Chunk 8).
 */
export type UseI18nResult = I18nContextValue & {
  /** Resolves a locale-free `Message` descriptor ({ key, params }) to a display string. */
  tm: (message: Message) => string;
  /** Resolves a `Label` (verbatim user text or a `Message`) to a display string. */
  tl: (label: Label) => string;
};

const NO_PROVIDER_ERROR =
  "useI18n() was called outside <I18nProvider>. Wrap this window's root " +
  "component in <I18nProvider> (see MainWindow/index.tsx for an example).";

/**
 * Returns `{ locale, setLocale, t, tm, tl, dir, formatNumber,
 * formatCompactNumber, formatCurrency, formatPercent, formatDate,
 * formatDateTime, formatRelativeTime, dateFnsLocale }`.
 *
 * Throws if called outside `<I18nProvider>` — every renderer entrypoint
 * (`MainWindow`, `TrayWindow`, `PromptGenWindow`, `CorrectionResultWindow`)
 * mounts the provider at its root, so this should never fire in practice.
 *
 * `tm`/`tl` are wrapped in `useCallback` keyed on `context` (which — per
 * `I18nProvider`'s own `useMemo` — only changes identity when `locale`
 * changes, exactly like `context.t` itself), and the returned object is
 * itself wrapped in `useMemo` for the same reason. Without this, every
 * consumer got a *fresh* `tm`/`tl` (and a fresh result object) on every
 * render regardless of locale, which silently defeated any `useMemo`/
 * `useCallback` dependency array downstream that (correctly) listed them —
 * e.g. `PresetWeightChart.tsx`'s chart-build memo never actually memoized.
 * All hooks below are called unconditionally (before the provider-presence
 * check) so this satisfies `react-hooks/rules-of-hooks`; the check itself
 * only ever throws inside a callback/memo body, which never executes when
 * `context` is null (nothing downstream can call `tm`/`tl` if `useI18n()`
 * itself already threw).
 */
export const useI18n = (): UseI18nResult => {
  const context = useContext(I18nContext);

  const tm = useCallback(
    (message: Message): string => {
      if (!context) throw new Error(NO_PROVIDER_ERROR);
      return resolveMessage(message, context.t);
    },
    [context],
  );

  const tl = useCallback(
    (label: Label): string => {
      if (!context) throw new Error(NO_PROVIDER_ERROR);
      return resolveLabel(label, context.t);
    },
    [context],
  );

  return useMemo<UseI18nResult>(() => {
    if (!context) throw new Error(NO_PROVIDER_ERROR);
    return { ...context, tm, tl };
  }, [context, tm, tl]);
};
