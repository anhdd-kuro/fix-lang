/**
 * @file shared.ts
 * @description Shared PURE analytics primitives reused by the Overview (#57)
 * and Models (#58) tabs. Electron/sqlite/React-free so it is unit-testable and
 * importable by any analytics consumer. Extracted from #57's
 * overviewAggregations once a second consumer (#58) needed ≥2 of these helpers
 * (#57 HITL #1 extraction trigger).
 */
import type { HistoryEntry } from "~/stores/historyStore";

export type AnalyticsRange = "all" | "30d" | "7d";

const RANGE_DAYS: Record<Exclude<AnalyticsRange, "all">, number> = {
  "30d": 30,
  "7d": 7,
};

/**
 * Filter entries to a range window using each entry's timestamp. "all" returns
 * all entries. "7d"/"30d" keep entries with `timestamp >= now - N days`
 * (inclusive). `now` is injected for deterministic tests.
 */
export const filterByRange = (
  entries: HistoryEntry[],
  range: AnalyticsRange,
  now: Date
): HistoryEntry[] => {
  if (range === "all") {
    return entries;
  }
  const days = RANGE_DAYS[range];
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
};

/**
 * Whether an entry carries a real (summable) cost: `costStatus` "ok"/"zero"
 * with a numeric `estimatedCostUsd`. "na"/absent are NOT summable.
 */
export const isPricedEntry = (entry: HistoryEntry): boolean =>
  (entry.costStatus === "ok" || entry.costStatus === "zero") &&
  entry.estimatedCostUsd !== undefined &&
  entry.estimatedCostUsd !== null;

export type CostSum = {
  /** Sum of priced entries' cost (ok + zero). */
  totalUsd: number;
  /** How many entries contributed a real number. */
  pricedCount: number;
  /** Total entries considered. */
  total: number;
  /** True when at least one entry was N/A (unpriced/absent). */
  hasNa: boolean;
};

/**
 * Sum estimated cost honestly: only priced (ok/zero) entries contribute;
 * "na"/absent are excluded and surfaced via `hasNa` so callers never show a
 * false 0.
 */
export const sumCost = (entries: HistoryEntry[]): CostSum => {
  let totalUsd = 0;
  let pricedCount = 0;
  let hasNa = false;
  for (const e of entries) {
    if (isPricedEntry(e)) {
      totalUsd += e.estimatedCostUsd as number;
      pricedCount += 1;
    } else {
      hasNa = true;
    }
  }
  return { totalUsd, pricedCount, total: entries.length, hasNa };
};

/**
 * Format a USD total: exact "$0.00" for zero, sub-cent precision so tiny costs
 * don't collapse to "$0.00", else 2 decimals. Mirrors #56's per-entry approach.
 */
export const formatUsd = (amount: number): string => {
  if (amount === 0) {
    return "$0.00";
  }
  if (amount > 0 && amount < 0.01) {
    return `$${amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return `$${amount.toFixed(2)}`;
};
