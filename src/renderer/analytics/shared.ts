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

/** Local-day key "YYYY-MM-DD" for a Date (local timezone, no UTC round-trip). */
export const dayKeyOfDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Local-day key "YYYY-MM-DD" for an ISO timestamp (local timezone). */
export const dayKeyOfIso = (iso: string): string => dayKeyOfDate(new Date(iso));

/**
 * Dense, inclusive list of local-day keys covering the range window, oldest
 * first. For "7d"/"30d" the window is the last N days ending today. For "all"
 * it spans the earliest entry's day → today (or just today when empty). Empty
 * days are present so timelines/heatmaps render gaps. `now` injected for tests.
 */
export const denseDayKeys = (
  entries: HistoryEntry[],
  range: AnalyticsRange,
  now: Date
): string[] => {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  let start: Date;
  if (range === "all") {
    if (entries.length === 0) {
      start = new Date(end);
    } else {
      let earliest = Infinity;
      for (const e of entries) {
        const t = new Date(e.timestamp).getTime();
        if (t < earliest) {
          earliest = t;
        }
      }
      start = new Date(earliest);
      start.setHours(0, 0, 0, 0);
    }
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  }

  const keys: string[] = [];
  const cursor = new Date(start);
  // Safety cap (~6 years) to avoid runaway loops on bad data.
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 2200) {
    keys.push(dayKeyOfDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
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
