/**
 * @file usageFormat.ts
 * @description Provider-neutral formatting for the Usage tab.
 *
 * The USD formatter lives here as the single implementation and is re-exported
 * from `openRouterFormat.ts` under its old name, so the tray credit balance and
 * its tests keep working unchanged.
 *
 * The degraded-card wording is separate from OpenRouter's on purpose: OpenRouter's
 * strings name a "provisioning key", which is the wrong thing to tell someone
 * looking at the OpenAI panel, where the credential is an Admin key.
 */
import type { Translator } from "~/shared/i18n/translate";

/**
 * Format USD amounts for provider spend display. Providers bill in USD
 * regardless of interface locale, so this intentionally does not use
 * `formatCurrency` (which would localize digit grouping but not the currency
 * itself) — the fixed `$` prefix matches the providers' own dashboards.
 */
export const formatUsageUsd = (n: number): string =>
  n === 0
    ? "$0.00"
    : n > 0 && n < 0.01
      ? `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`
      : `$${n.toFixed(2)}`;

export type UsageDegradedReason =
  | "unauthorized"
  | "unavailable"
  | "parse_error"
  | "no_key";

/** Message for a degraded (non-ok) usage card result, in admin-key wording. */
export const usageDegradedMessage = (
  reason: UsageDegradedReason,
  t: Translator,
): string => {
  switch (reason) {
    case "unauthorized":
      return t("usage.degraded.unauthorized");
    case "no_key":
      return t("usage.degraded.noKey");
    default:
      return t("usage.degraded.unavailable");
  }
};
