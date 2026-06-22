/** Format USD amounts for OpenRouter credit display. */
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
  reason: OpenRouterDegradedReason
): string => {
  switch (reason) {
    case "unauthorized":
      return "Unauthorized — check your provisioning key.";
    case "no_key":
      return "No provisioning key set.";
    default:
      return "Unavailable right now.";
  }
};
