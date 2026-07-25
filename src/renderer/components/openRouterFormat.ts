import type { Translator } from "~/shared/i18n/translate";

/**
 * Format USD amounts for OpenRouter credit display. OpenRouter always bills
 * in USD regardless of interface locale, so this intentionally does not use
 * `formatCurrency` (which would localize digit grouping but not the currency
 * itself) — the fixed `$` prefix matches OpenRouter's own dashboard.
 */
export const formatOpenRouterUsd = (n: number): string =>
  n === 0
    ? "$0.00"
    : n > 0 && n < 0.01
      ? `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`
      : `$${n.toFixed(2)}`;

export type OpenRouterDegradedReason =
  | "unauthorized"
  | "unavailable"
  | "parse_error"
  | "no_key";

/** Message for a degraded (non-ok) OpenRouter card result. */
export const openRouterDegradedMessage = (
  reason: OpenRouterDegradedReason,
  t: Translator,
): string => {
  switch (reason) {
    case "unauthorized":
      return t("models.openrouter.degraded.unauthorized");
    case "no_key":
      return t("models.openrouter.degraded.noKey");
    default:
      return t("models.openrouter.degraded.unavailable");
  }
};
