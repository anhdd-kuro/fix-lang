/**
 * @file overviewAggregations.ts
 * @description PURE aggregation layer for the Overview tab (#57). Transforms
 * `HistoryEntry[]` (the corrections bucket) into the view shapes the cards +
 * heatmap render. No electron/sqlite/React dependency — every function is a
 * pure data transform and is unit-tested directly (no DOM test library; see
 * #54 HITL #4). `now` is injected wherever "today" matters so tests are
 * deterministic.
 *
 * Day bucketing is LOCAL-day (matches the user's lived activity, per PRD).
 * Cost totals are N/A-aware: only `costStatus` "ok"/"zero" entries contribute;
 * "na"/absent are excluded and surfaced, never counted as a false 0.
 */
import type { HistoryEntry } from "~/stores/historyStore";

export type OverviewRange = "all" | "30d" | "7d";

const RANGE_DAYS: Record<Exclude<OverviewRange, "all">, number> = {
  "30d": 30,
  "7d": 7,
};

/** Local-day key "YYYY-MM-DD" for an ISO timestamp (local timezone). */
export const localDayKey = (iso: string): string => {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Build a stable local-day key directly from a Date without an ISO round-trip
// (toISOString is UTC and could shift the day). Used by the dense heatmap +
// streak walk so day boundaries stay in local time.
const dayKeyOf = (d: Date): string => {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Filter entries to a range window using each entry's timestamp. "all" returns
 * all entries. "7d"/"30d" keep entries with `timestamp >= now - N days`
 * (inclusive boundary). `now` injected for determinism.
 */
export const filterByRange = (
  entries: HistoryEntry[],
  range: OverviewRange,
  now: Date
): HistoryEntry[] => {
  if (range === "all") {
    return entries;
  }
  const days = RANGE_DAYS[range];
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
};

export const totalCorrections = (entries: HistoryEntry[]): number =>
  entries.length;

export const totalTokens = (entries: HistoryEntry[]): number =>
  entries.reduce(
    (sum, e) => sum + (e.promptTokens ?? 0) + (e.completionTokens ?? 0),
    0
  );

export type CostTotal = {
  /** Sum of priced entries' cost (ok + zero). */
  totalUsd: number;
  /** How many entries contributed a real number (ok/zero). */
  pricedCount: number;
  /** Total entries considered. */
  total: number;
  /** True when at least one entry was N/A (unpriced/absent). */
  hasNa: boolean;
};

/**
 * Sum estimated cost honestly: only entries whose `costStatus` is "ok" or
 * "zero" (a real number) contribute. "na"/absent are excluded from the total
 * AND reported via `hasNa` so the card can show "(K of M priced)" / N/A.
 */
export const costTotal = (entries: HistoryEntry[]): CostTotal => {
  let totalUsd = 0;
  let pricedCount = 0;
  let hasNa = false;
  for (const e of entries) {
    const priced =
      (e.costStatus === "ok" || e.costStatus === "zero") &&
      e.estimatedCostUsd !== undefined &&
      e.estimatedCostUsd !== null;
    if (priced) {
      totalUsd += e.estimatedCostUsd as number;
      pricedCount += 1;
    } else {
      hasNa = true;
    }
  }
  return { totalUsd, pricedCount, total: entries.length, hasNa };
};

/** Distinct local-days with ≥1 correction. */
export const activeDays = (entries: HistoryEntry[]): number => {
  const days = new Set<string>();
  for (const e of entries) {
    days.add(localDayKey(e.timestamp));
  }
  return days.size;
};

export type Streaks = { current: number; longest: number };

/**
 * Consecutive active-day streaks over the set of active local-days.
 * `current` counts back from today (or yesterday, if today is inactive but
 * yesterday is active); `longest` is the maximum consecutive run. Empty → {0,0}.
 */
export const streaks = (entries: HistoryEntry[], now: Date): Streaks => {
  const dayKeys = new Set<string>();
  for (const e of entries) {
    dayKeys.add(localDayKey(e.timestamp));
  }
  if (dayKeys.size === 0) {
    return { current: 0, longest: 0 };
  }

  // Longest run: sort day keys, walk consecutive calendar days.
  const sorted = [...dayKeys].sort();
  let longest = 1;
  let run = 1;
  const dayDiff = (a: string, b: string): number =>
    Math.round(
      (new Date(`${b}T00:00:00`).getTime() -
        new Date(`${a}T00:00:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    );
  for (let i = 1; i < sorted.length; i++) {
    if (dayDiff(sorted[i - 1], sorted[i]) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  // Current run: count back from today; if today inactive, allow starting at
  // yesterday (an active streak that hasn't been extended today yet).
  const cursor = new Date(now);
  const todayKey = dayKeyOf(cursor);
  let startActive = dayKeys.has(todayKey);
  if (!startActive) {
    cursor.setDate(cursor.getDate() - 1);
    startActive = dayKeys.has(dayKeyOf(cursor));
  }
  let current = 0;
  while (startActive && dayKeys.has(dayKeyOf(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, longest };
};

/** Busiest local hour-of-day (0–23). Ties resolved to the lowest hour. Empty → null. */
export const peakHour = (entries: HistoryEntry[]): number | null => {
  if (entries.length === 0) {
    return null;
  }
  const counts = new Array<number>(24).fill(0);
  for (const e of entries) {
    counts[new Date(e.timestamp).getHours()] += 1;
  }
  let best = 0;
  for (let h = 1; h < 24; h++) {
    if (counts[h] > counts[best]) {
      best = h;
    }
  }
  return counts[best] === 0 ? null : best;
};

/**
 * Most-frequent served model (`resolvedModel ?? model`). Undefined/empty model
 * ids are excluded. Ties resolved to the first-seen id. Empty → null.
 */
export const favoriteModel = (entries: HistoryEntry[]): string | null => {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const id = (e.resolvedModel ?? e.model ?? "").trim();
    if (id.length === 0) {
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
};

export type PresetBreakdownRow = { presetName: string; count: number };

/** Untitled/legacy bucket label for entries with no presetName (HITL #4). */
export const UNTITLED_PRESET_LABEL = "Other";

/**
 * Count by presetName, sorted desc by count. Entries without a presetName are
 * grouped under "Other" (visible + honest). Ties keep first-seen order.
 */
export const perPresetBreakdown = (
  entries: HistoryEntry[]
): PresetBreakdownRow[] => {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const name =
      e.presetName && e.presetName.trim().length > 0
        ? e.presetName
        : UNTITLED_PRESET_LABEL;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([presetName, count]) => ({ presetName, count }))
    .sort((a, b) => b.count - a.count);
};

export type HeatmapBucket = { date: string; count: number };

/**
 * Dense per-day buckets across the range window (empty days render as
 * zero-intensity cells, GitHub-style). For "7d"/"30d" the window is the last N
 * days ending today. For "all" the window spans the earliest entry's day to
 * today (or just today when there are no entries).
 */
export const heatmapBuckets = (
  entries: HistoryEntry[],
  range: OverviewRange,
  now: Date
): HeatmapBucket[] => {
  // Count corrections per local-day.
  const perDay = new Map<string, number>();
  for (const e of entries) {
    const key = localDayKey(e.timestamp);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const endOfToday = new Date(now);
  endOfToday.setHours(0, 0, 0, 0);

  // Determine the inclusive start day.
  let start: Date;
  if (range === "all") {
    if (perDay.size === 0) {
      start = new Date(endOfToday);
    } else {
      const earliestKey = [...perDay.keys()].sort()[0];
      start = new Date(`${earliestKey}T00:00:00`);
    }
  } else {
    start = new Date(endOfToday);
    start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  }

  const buckets: HeatmapBucket[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  // Safety cap to avoid runaway loops on bad data (≈ 6 years of days).
  let guard = 0;
  while (cursor.getTime() <= endOfToday.getTime() && guard < 2200) {
    const key = dayKeyOf(cursor);
    buckets.push({ date: key, count: perDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return buckets;
};

/**
 * Map a count to a 0–4 intensity level (GitHub-style, 5 buckets: 0 = empty).
 * `max` is the busiest day's count in the window; thresholds are quartiles of
 * `max` so the palette scales to the data. Pure — the panel maps level→class.
 */
export const intensityLevel = (count: number, max: number): number => {
  if (count <= 0 || max <= 0) {
    return 0;
  }
  const ratio = count / max;
  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }
  return 4;
};
