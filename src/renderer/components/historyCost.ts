/**
 * @file historyCost.ts
 * @description Pure presentation helper for a history entry's cost snapshot
 * (#56). Mirrors historyModel.ts — no React/electron dependency, the primary
 * test seam for cost display.
 *
 * Honesty rules (must match cost.ts):
 * - status "zero" (Ollama/local) → "$0.00" (NOT "N/A").
 * - status "na" / absent / null cost → "N/A" (NOT "$0").
 * - status "ok" → USD, with enough precision that tiny sub-cent costs do not
 *   collapse to "$0.00".
 */
import type { HistoryEntry } from "~/stores/historyStore";

/**
 * Format a USD amount. Cents and above use 2 decimals ("$1.23"); sub-cent
 * amounts widen precision (up to 6 decimals) so they don't round to "$0.00".
 */
const formatUsd = (amount: number): string => {
  if (amount === 0) {
    return "$0.00";
  }
  // Below one cent: show up to 6 significant decimals, trimming trailing zeros.
  if (amount > 0 && amount < 0.01) {
    const trimmed = amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return `$${trimmed}`;
  }
  return `$${amount.toFixed(2)}`;
};

/**
 * Build the cost label for a history entry.
 * @returns "$0.00" for a genuine zero (local), a USD string for a priced cost,
 *          or "N/A" when the cost could not be determined.
 */
export const formatCost = (
  entry: Pick<HistoryEntry, "costStatus" | "estimatedCostUsd">
): string => {
  if (entry.costStatus === "zero") {
    return "$0.00";
  }
  if (
    entry.costStatus === "ok" &&
    entry.estimatedCostUsd !== undefined &&
    entry.estimatedCostUsd !== null
  ) {
    return formatUsd(entry.estimatedCostUsd);
  }
  // "na", undefined (legacy/migrated rows), or any inconsistent state → N/A.
  return "N/A";
};
