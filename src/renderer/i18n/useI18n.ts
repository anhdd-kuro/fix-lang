/**
 * @file useI18n.ts
 * @description Consumer hook for the renderer i18n runtime. Thin — all state
 * logic lives in `I18nProvider.tsx` / `localeState.ts`; this just reads the
 * context and fails loudly when a component forgets to mount the provider.
 */

import { useContext } from "react";
import {
  resolveLabel,
  resolveMessage,
  type Label,
  type Message,
} from "~/shared/i18n/message";
import { I18nContext, type I18nContextValue } from "./I18nProvider";

/**
 * `I18nContextValue` plus the two descriptor-resolving helpers the dashboard
 * aggregation layer needs (Chunk 8). Kept here rather than added to
 * `I18nContextValue` itself: `tm`/`tl` are thin, stateless wrappers over the
 * context's own `t`, so they are derived per-call instead of widening the
 * provider's memoized value.
 */
export type UseI18nResult = I18nContextValue & {
  /** Resolves a locale-free `Message` descriptor ({ key, params }) to a display string. */
  tm: (message: Message) => string;
  /** Resolves a `Label` (verbatim user text or a `Message`) to a display string. */
  tl: (label: Label) => string;
};

/**
 * Returns `{ locale, setLocale, t, tm, tl, dir, formatNumber,
 * formatCompactNumber, formatCurrency, formatPercent, formatDate,
 * formatDateTime, formatRelativeTime, dateFnsLocale }`.
 *
 * Throws if called outside `<I18nProvider>` — every renderer entrypoint
 * (`MainWindow`, `TrayWindow`, `PromptGenWindow`, `CorrectionResultWindow`)
 * mounts the provider at its root, so this should never fire in practice.
 */
export const useI18n = (): UseI18nResult => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error(
      "useI18n() was called outside <I18nProvider>. Wrap this window's root " +
        "component in <I18nProvider> (see MainWindow/index.tsx for an example).",
    );
  }
  return {
    ...context,
    tm: (message) => resolveMessage(message, context.t),
    tl: (label) => resolveLabel(label, context.t),
  };
};
