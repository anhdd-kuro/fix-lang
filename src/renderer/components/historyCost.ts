/**
 * @file historyCost.ts
 * @description Pure presentation helper for a history entry's cost snapshot
 * (#56). Mirrors historyModel.ts — no React/electron dependency, the primary
 * test seam for cost display.
 *
 * Honesty rules (must match cost.ts):
 * - status "zero" (Ollama/local) → "$0.00" (NOT "N/A").
 * - status "na" / absent / null cost → the translated "history.cost.na" key
 *   (NOT "$0").
 * - status "ok" → USD, with enough precision that tiny sub-cent costs do not
 *   collapse to "$0.00".
 *
 * i18n split: `resolveCostDisplay` is pure data (no locale dependency) so it
 * stays trivially testable; `formatCostLabel` renders it through the
 * caller-supplied translator + `formatNumber` so currency grouping/decimal
 * conventions follow the active locale.
 */
import type { HistoryEntry } from "~/features/history/store/historyStore";
import type { Formatters } from "~/features/i18n/shared/format";
import type { Translator } from "~/features/i18n/shared/translate";

/** Intent for rendering a history entry's cost — not yet a formatted string. */
export type CostDisplay =
  | { kind: "na" }
  | {
      kind: "amount";
      valueUsd: number;
      minimumFractionDigits: number;
      maximumFractionDigits: number;
    };

const SUB_CENT_DISPLAY = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
} as const;

const STANDARD_DISPLAY = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

/**
 * Determines how a history entry's cost should be rendered, without
 * formatting it — currency grouping/decimal conventions are locale-specific
 * and belong in `formatCostLabel`/`useI18n().formatNumber`.
 */
export const resolveCostDisplay = (
  entry: Pick<HistoryEntry, "costStatus" | "estimatedCostUsd">
): CostDisplay => {
  if (entry.costStatus === "zero") {
    return { kind: "amount", valueUsd: 0, ...STANDARD_DISPLAY };
  }
  if (
    entry.costStatus === "ok" &&
    entry.estimatedCostUsd !== undefined &&
    entry.estimatedCostUsd !== null
  ) {
    const amount = entry.estimatedCostUsd;
    if (amount > 0 && amount < 0.01) {
      return { kind: "amount", valueUsd: amount, ...SUB_CENT_DISPLAY };
    }
    return { kind: "amount", valueUsd: amount, ...STANDARD_DISPLAY };
  }
  // "na", undefined (legacy/migrated rows), or any inconsistent state → N/A.
  return { kind: "na" };
};

/**
 * Renders `resolveCostDisplay`'s result as a locale-aware string. `t`/
 * `formatNumber` come from `useI18n()` at the call site — this module has no
 * React/electron dependency so it stays unit-testable without a provider.
 */
export const formatCostLabel = (
  entry: Pick<HistoryEntry, "costStatus" | "estimatedCostUsd">,
  t: Translator,
  formatNumber: Formatters["formatNumber"]
): string => {
  const display = resolveCostDisplay(entry);
  if (display.kind === "na") {
    return t("history.cost.na");
  }
  return formatNumber(display.valueUsd, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: display.minimumFractionDigits,
    maximumFractionDigits: display.maximumFractionDigits,
  });
};
