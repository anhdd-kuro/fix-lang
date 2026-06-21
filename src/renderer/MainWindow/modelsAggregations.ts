/**
 * @file modelsAggregations.ts
 * @description PURE per-model aggregation for the Models tab (#58). Groups
 * corrections history by the concrete served model (`resolvedModel ?? model`,
 * hiding alias indirection per PRD user story 14) and computes each model's
 * usage share, token totals, and N/A-aware estimated cost. Reuses the shared
 * range filter + cost-sum from `../analytics/shared` (no duplication). No
 * electron/sqlite/DOM dependency — unit-tested directly.
 */
import { isPricedEntry } from "../analytics/shared";
import type { HistoryEntry } from "~/stores/historyStore";

/** Label for entries whose served model id is absent. */
export const UNKNOWN_MODEL_LABEL = "(unknown)";

/**
 * The canonical "served model" grouping key: prefer `resolvedModel`, fall back
 * to `model`, else the unknown label. Matches the project-wide
 * `resolvedModel ?? model` rule.
 */
export const groupKeyForEntry = (entry: HistoryEntry): string => {
  const resolved = entry.resolvedModel?.trim();
  if (resolved) {
    return resolved;
  }
  const model = entry.model?.trim();
  if (model) {
    return model;
  }
  return UNKNOWN_MODEL_LABEL;
};

export type ModelRow = {
  model: string;
  usageCount: number;
  /** Percent of the filtered set's total usage (rows sum to ~100%). */
  usageSharePct: number;
  totalTokens: number;
  /** Summed cost of priced entries; null when the whole group is N/A. */
  estimatedCostUsd: number | null;
  /** Count of priced (ok/zero) entries in the group. */
  pricedCount: number;
  /** True when any group entry is N/A (unpriced/absent). */
  costHasNa: boolean;
};

type Accumulator = {
  model: string;
  usageCount: number;
  totalTokens: number;
  costUsd: number;
  pricedCount: number;
  hasNa: boolean;
};

/**
 * Per-model breakdown over an already range-filtered entry set. Group the
 * entries by served model, sum usage/tokens/cost (N/A-aware), compute usage
 * share against the filtered total (divide-by-zero guarded), and sort by usage
 * count desc (ties keep first-seen order). Empty input → [].
 */
export const perModelBreakdown = (entries: HistoryEntry[]): ModelRow[] => {
  const totalUsage = entries.length;
  const groups = new Map<string, Accumulator>();

  for (const e of entries) {
    const key = groupKeyForEntry(e);
    const acc =
      groups.get(key) ??
      {
        model: key,
        usageCount: 0,
        totalTokens: 0,
        costUsd: 0,
        pricedCount: 0,
        hasNa: false,
      };
    acc.usageCount += 1;
    acc.totalTokens += (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
    if (isPricedEntry(e)) {
      acc.costUsd += e.estimatedCostUsd as number;
      acc.pricedCount += 1;
    } else {
      acc.hasNa = true;
    }
    groups.set(key, acc);
  }

  return [...groups.values()]
    .map((acc) => ({
      model: acc.model,
      usageCount: acc.usageCount,
      // Guard divide-by-zero: empty set yields no rows, but keep it explicit.
      usageSharePct:
        totalUsage > 0 ? (acc.usageCount / totalUsage) * 100 : 0,
      totalTokens: acc.totalTokens,
      // Whole group N/A → null (never a fabricated 0); else the priced sum.
      estimatedCostUsd: acc.pricedCount > 0 ? acc.costUsd : null,
      pricedCount: acc.pricedCount,
      costHasNa: acc.hasNa,
    }))
    .sort((a, b) => b.usageCount - a.usageCount);
};
