/**
 * @file usage.ts
 * @description Shapes shared by every provider's Usage panel — the range union,
 * the daily series both charts read, and the donut's cost slices.
 *
 * Electron-free and provider-free on purpose: main parses into these, preload
 * passes them through, the renderer charts them. Provider-specific cards (an
 * OpenRouter credit balance, an OpenAI line-item breakdown) stay in that
 * provider's own module — only what is genuinely common lives here.
 */

export type UsageRange = "7d" | "30d";

/** Coerce an untrusted value (IPC payload, stored preference) to the union. */
export const normalizeUsageRange = (raw: unknown): UsageRange =>
  raw === "30d" ? "30d" : "7d";

export const usageRangeDays = (range: UsageRange): number =>
  range === "30d" ? 30 : 7;

/**
 * One UTC day of activity. `costUsd` is `null` when the provider reports usage
 * but not money for that grain — OpenAI groups cost by line item and never by
 * model, so a per-model row genuinely has no cost. `null` must render as "—",
 * never as `0`: a zero reads as "this was free".
 */
export type UsageDailyPoint = {
  /** UTC day key, "YYYY-MM-DD". */
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

/** A per-model row of the usage table. `costUsd: null` — see `UsageDailyPoint`. */
export type UsageModelRow = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

/** A donut slice of real billed spend. Never an estimate. */
export type UsageCostSlice = {
  label: string;
  costUsd: number;
};

/** UTC day key for a Date — the grain every provider's buckets are keyed by. */
export const utcDayKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Inclusive UTC-midnight start of the range, as unix seconds (what OpenAI's
 * `start_time` expects). Midnight-aligned so a refresh mid-afternoon returns the
 * same buckets as one at breakfast, instead of silently shifting the window.
 */
export const usageRangeStartUnix = (
  range: UsageRange,
  now: Date = new Date(),
): number => {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const start = midnight - (usageRangeDays(range) - 1) * 24 * 60 * 60 * 1000;
  return Math.floor(start / 1000);
};

/** Sum of a daily series' cost, skipping days the provider priced as `null`. */
export const totalCostUsd = (points: readonly UsageDailyPoint[]): number =>
  points.reduce((sum, point) => sum + (point.costUsd ?? 0), 0);
