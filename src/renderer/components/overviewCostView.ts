/**
 * @file overviewCostView.ts
 * @description Pure presentation helper for the Overview Total tokens card's
 * estimated-cost hint. Mirrors historyCost.ts — no React/electron dependency.
 *
 * Honesty rules (must match sumCost / cost.ts):
 * - No priced entries in range → "Est. cost N/A" (never a fabricated $0).
 * - Partial coverage (hasNa) → sum of priced entries + "{priced} of {total} priced".
 * - Full coverage → "Est. {cost}" only.
 */
import type { CostSum } from "../analytics/shared";
import type { Formatters } from "~/shared/i18n/format";
import type { Translator } from "~/shared/i18n/translate";

export type OverviewCostHintDisplay =
  | { kind: "none" }
  | { kind: "na" }
  | {
      kind: "amount";
      valueUsd: number;
      minimumFractionDigits: number;
      maximumFractionDigits: number;
      partial?: { priced: number; total: number };
    };

const SUB_CENT_DISPLAY = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
} as const;

const STANDARD_DISPLAY = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

/** Maps an N/A-aware cost sum to a render intent — not yet a formatted string. */
export const resolveOverviewCostHint = (
  cost: CostSum
): OverviewCostHintDisplay => {
  if (cost.total === 0) {
    return { kind: "none" };
  }
  if (cost.pricedCount === 0) {
    return { kind: "na" };
  }

  const amount = cost.totalUsd;
  const digits =
    amount > 0 && amount < 0.01 ? SUB_CENT_DISPLAY : STANDARD_DISPLAY;

  return {
    kind: "amount",
    valueUsd: amount,
    ...digits,
    partial: cost.hasNa
      ? { priced: cost.pricedCount, total: cost.total }
      : undefined,
  };
};

/** Renders `resolveOverviewCostHint`'s result as a locale-aware hint line. */
export const formatOverviewCostHint = (
  cost: CostSum,
  t: Translator,
  formatNumber: Formatters["formatNumber"]
): string | undefined => {
  const display = resolveOverviewCostHint(cost);
  if (display.kind === "none") {
    return undefined;
  }
  if (display.kind === "na") {
    return t("overview.value.estimatedCostNa");
  }

  const costLabel = formatNumber(display.valueUsd, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: display.minimumFractionDigits,
    maximumFractionDigits: display.maximumFractionDigits,
  });

  if (display.partial) {
    return t("overview.value.estimatedCostPartial", {
      cost: costLabel,
      priced: display.partial.priced,
      total: display.partial.total,
    });
  }

  return t("overview.value.estimatedCost", { cost: costLabel });
};
