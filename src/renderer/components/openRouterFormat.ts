import { formatUsageUsd } from "./usage/usageFormat";
import type { Translator } from "~/shared/i18n/translate";

/**
 * Format USD amounts for OpenRouter credit display. One implementation, shared
 * with the other providers' Usage panels — see `usage/usageFormat.ts`. This name
 * is kept because the tray credit balance and its tests import it.
 */
export const formatOpenRouterUsd = formatUsageUsd;

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
