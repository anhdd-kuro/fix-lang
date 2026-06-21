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
import {
  denseDayKeys,
  filterByRange,
  sumCost,
  type AnalyticsRange,
  type CostSum,
} from "../analytics/shared";
import type { HistoryEntry } from "~/stores/historyStore";

// Range + range filter now live in the shared analytics module (#58 extraction
// per #57 HITL #1). Re-exported here so existing Overview consumers are
// unchanged.
export type OverviewRange = AnalyticsRange;
export { filterByRange };

// Day spans for the bounded ranges — used locally by the dense heatmap to size
// the window. (filterByRange uses its own copy in the shared module.)
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

export const totalCorrections = (entries: HistoryEntry[]): number =>
  entries.length;

export const totalTokens = (entries: HistoryEntry[]): number =>
  entries.reduce(
    (sum, e) => sum + (e.promptTokens ?? 0) + (e.completionTokens ?? 0),
    0
  );

// Cost total is the shared N/A-aware sum (kept as a named export for existing
// Overview consumers / tests).
export type CostTotal = CostSum;
export const costTotal = sumCost;

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

export type ModelProvider = {
  /** Provider segment before the first "/" (e.g. "openai"); null when absent. */
  provider: string | null;
  /** Model segment after the first "/" (or the whole id when there's no "/"). */
  model: string | null;
};

/**
 * Strip a trailing version-date suffix from a model id so snapshots collapse to
 * their family: "gpt-5.4-mini-20260317" → "gpt-5.4-mini" (also handles the
 * dashed "-2026-03-17" form). Anything else is returned unchanged; null stays
 * null. Only a date at the very end is removed (mid-id digits are preserved).
 */
export const stripModelDate = (id: string | null): string | null => {
  if (!id) {
    return id;
  }
  return id.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
};

/**
 * Split a served model id ("provider/model", e.g. "openai/gpt-4o") into its
 * provider and model parts. No "/" → provider null, model = the whole id.
 * null/blank → both null.
 */
export const splitModelId = (id: string | null): ModelProvider => {
  const trimmed = id?.trim() ?? "";
  if (trimmed.length === 0) {
    return { provider: null, model: null };
  }
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return { provider: null, model: trimmed };
  }
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
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

export type Sessions = number;

/** Gap (minutes) of inactivity that separates one usage session from the next. */
export const SESSION_GAP_MINUTES = 30;

/**
 * Count usage sessions: sort entries by time, then break into a new session
 * whenever the idle gap between consecutive entries exceeds SESSION_GAP_MINUTES.
 * Empty → 0; a single entry → 1.
 */
export const sessionCount = (
  entries: HistoryEntry[],
  gapMinutes: number = SESSION_GAP_MINUTES
): Sessions => {
  if (entries.length === 0) {
    return 0;
  }
  const times = entries
    .map((e) => new Date(e.timestamp).getTime())
    .sort((a, b) => a - b);
  const gapMs = gapMinutes * 60 * 1000;
  let sessions = 1;
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > gapMs) {
      sessions += 1;
    }
  }
  return sessions;
};

/** Total messages exchanged — one per history entry (a request/response pair). */
export const messageCount = (entries: HistoryEntry[]): number => entries.length;

/** Number of 4-hour vertical blocks in the hour-block heatmap (6 × 4h = 24h). */
export const HOUR_BLOCKS = 6;
export const HOURS_PER_BLOCK = 24 / HOUR_BLOCKS;

export type HourBlockHeatmap = {
  /** Dense local-day keys (oldest first) — the horizontal axis. */
  days: string[];
  /** cells[dayIndex][blockIndex] = activity count; blockIndex 0 = 00:00–04:00. */
  cells: number[][];
  /** Busiest cell count in the window (0 when empty) — for intensity scaling. */
  max: number;
};

/** Floor for the heatmap window: always show at least 30 days ending today. */
export const HEATMAP_MIN_DAYS = 30;

/**
 * Day × hour-block heatmap: horizontal axis = days, vertical axis = 6 four-hour
 * blocks of the day (block 0 = 00:00–04:00 … block 5 = 20:00–24:00). Each cell
 * counts entries in that day + block (local time).
 *
 * The window width is floored to `minDays` (default 30) ending today and only
 * ever widens, so a single day of history still renders a full span. The panel
 * passes a width-derived `minDays` so the heatmap fills the available screen
 * (more columns on wider screens). Pure; `now` injected.
 */
export const hourBlockHeatmap = (
  entries: HistoryEntry[],
  range: OverviewRange,
  now: Date,
  minDays: number = HEATMAP_MIN_DAYS
): HourBlockHeatmap => {
  const days = denseDayKeys(entries, range, now, Math.max(HEATMAP_MIN_DAYS, minDays));
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const cells = days.map(() => new Array<number>(HOUR_BLOCKS).fill(0));

  for (const e of entries) {
    const di = dayIndex.get(localDayKey(e.timestamp));
    if (di === undefined) {
      continue;
    }
    const hour = new Date(e.timestamp).getHours();
    const block = Math.min(HOUR_BLOCKS - 1, Math.floor(hour / HOURS_PER_BLOCK));
    cells[di][block] += 1;
  }

  let max = 0;
  for (const row of cells) {
    for (const c of row) {
      if (c > max) {
        max = c;
      }
    }
  }
  return { days, cells, max };
};

/** Reference token budget the benchmark sentence compares against. */
export const BENCHMARK_TOKENS = 100_000;

/**
 * Short, honest comparison of the range's token usage against a fixed reference
 * budget. Never fabricates precision — rounds to whole percent.
 */
export const benchmarkSentence = (
  tokens: number,
  benchmark: number = BENCHMARK_TOKENS
): string => {
  if (tokens <= 0) {
    return "No token usage in this range yet.";
  }
  const pct = Math.round((tokens / benchmark) * 100);
  const ref = `${(benchmark / 1000).toLocaleString()}k-token reference budget`;
  if (pct >= 100) {
    return `You've used ${tokens.toLocaleString()} tokens — ${pct}% of the ${ref}.`;
  }
  return `You've used ${tokens.toLocaleString()} tokens — ${pct}% of the ${ref}, ${
    100 - pct
  }% headroom left.`;
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
