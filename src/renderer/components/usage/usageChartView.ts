/**
 * @file usageChartView.ts
 * @description PURE view-model builders for the Usage tab's three charts, shared
 * by every provider panel. No `chart.js` import and no DOM access, so the axis
 * labels, series values and slice ordering are unit-testable directly (no DOM
 * testing library is installed). Mirrors the `presetChartView.ts` split.
 */
import type { UsageCostSlice, UsageDailyPoint } from "~/shared/usage";

/** Largest slices first, with a "+N more" bucket so the donut stays readable. */
export const MAX_DONUT_SLICES = 6;

/** Bars: one real billed figure per day. Days the provider never priced are 0. */
export const dailyCostSeries = (
  points: readonly UsageDailyPoint[],
): { dates: string[]; costs: number[] } => ({
  dates: points.map((point) => point.date),
  costs: points.map((point) => point.costUsd ?? 0),
});

/** Lines: input vs output tokens per day, aligned to the same date axis. */
export const dailyTokenSeries = (
  points: readonly UsageDailyPoint[],
): { dates: string[]; inputTokens: number[]; outputTokens: number[] } => ({
  dates: points.map((point) => point.date),
  inputTokens: points.map((point) => point.inputTokens),
  outputTokens: points.map((point) => point.outputTokens),
});

/**
 * Whether a daily series carries any cost at all. A provider can report tokens
 * with no money (OpenAI's completions endpoint), and an all-zero cost chart
 * reads as "you spent nothing" rather than "this endpoint has no prices".
 */
export const hasCostData = (points: readonly UsageDailyPoint[]): boolean =>
  points.some((point) => point.costUsd !== null && point.costUsd > 0);

export const hasTokenData = (points: readonly UsageDailyPoint[]): boolean =>
  points.some((point) => point.inputTokens > 0 || point.outputTokens > 0);

/**
 * Donut slices, descending, collapsing the tail into one remainder slice. The
 * remainder is returned with a null label so the caller supplies a translated
 * one — this module stays locale-free.
 */
export const costDonutSlices = (
  slices: readonly UsageCostSlice[],
  maxSlices: number = MAX_DONUT_SLICES,
): { slices: UsageCostSlice[]; remainder: { count: number; costUsd: number } | null } => {
  const positive = slices
    .filter((slice) => slice.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd);

  if (positive.length <= maxSlices) {
    return { slices: positive, remainder: null };
  }

  const head = positive.slice(0, maxSlices - 1);
  const tail = positive.slice(maxSlices - 1);
  return {
    slices: head,
    remainder: {
      count: tail.length,
      costUsd: tail.reduce((sum, slice) => sum + slice.costUsd, 0),
    },
  };
};

/** Percent of total spend for a slice, to one decimal (matches presetChartView). */
export const sharePercent = (costUsd: number, totalUsd: number): number =>
  totalUsd > 0 ? Math.round((costUsd / totalUsd) * 1000) / 10 : 0;
