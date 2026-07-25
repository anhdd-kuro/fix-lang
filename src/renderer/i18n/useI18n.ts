/**
 * @file useI18n.ts
 * @description Consumer hook for the renderer i18n runtime. Thin — all state
 * logic lives in `I18nProvider.tsx` / `localeState.ts`; this just reads the
 * context and fails loudly when a component forgets to mount the provider.
 */

import { useContext } from "react";
import { I18nContext, type I18nContextValue } from "./I18nProvider";

/**
 * Returns `{ locale, setLocale, t, dir, formatNumber, formatCompactNumber,
 * formatCurrency, formatPercent, formatDate, formatDateTime,
 * formatRelativeTime, dateFnsLocale }`.
 *
 * Throws if called outside `<I18nProvider>` — every renderer entrypoint
 * (`MainWindow`, `TrayWindow`, `PromptGenWindow`, `CorrectionResultWindow`)
 * mounts the provider at its root, so this should never fire in practice.
 */
export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error(
      "useI18n() was called outside <I18nProvider>. Wrap this window's root " +
        "component in <I18nProvider> (see MainWindow/index.tsx for an example).",
    );
  }
  return context;
};
