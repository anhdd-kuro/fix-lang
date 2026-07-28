import { describe, expect, it } from "vitest";
import {
  costDonutSlices,
  dailyCostSeries,
  dailyTokenSeries,
  hasCostData,
  hasTokenData,
  MAX_DONUT_SLICES,
  sharePercent,
} from "./usageChartView";
import type { UsageDailyPoint } from "~/shared/usage";

const point = (overrides: Partial<UsageDailyPoint> = {}): UsageDailyPoint => ({
  date: "2026-07-01",
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ...overrides,
});

describe("daily series", () => {
  it("keeps the given order as the shared date axis", () => {
    const points = [
      point({ date: "2026-07-01", costUsd: 1.5 }),
      point({ date: "2026-07-02", costUsd: 2 }),
    ];

    expect(dailyCostSeries(points)).toEqual({
      dates: ["2026-07-01", "2026-07-02"],
      costs: [1.5, 2],
    });
  });

  it("charts an unpriced day as 0 while still reporting no cost data", () => {
    const points = [point({ costUsd: null, inputTokens: 10 })];

    expect(dailyCostSeries(points).costs).toEqual([0]);
    // The bar is 0, but the panel must be able to say "no prices" instead of
    // letting a flat zero read as "you spent nothing".
    expect(hasCostData(points)).toBe(false);
  });

  it("splits input and output tokens into aligned series", () => {
    const points = [
      point({ date: "2026-07-01", inputTokens: 100, outputTokens: 20 }),
      point({ date: "2026-07-02", inputTokens: 5, outputTokens: 1 }),
    ];

    expect(dailyTokenSeries(points)).toEqual({
      dates: ["2026-07-01", "2026-07-02"],
      inputTokens: [100, 5],
      outputTokens: [20, 1],
    });
  });

  it("reports cost and token presence independently", () => {
    expect(hasCostData([point({ costUsd: 0 })])).toBe(false);
    expect(hasCostData([point({ costUsd: 0.004 })])).toBe(true);
    expect(hasTokenData([point()])).toBe(false);
    expect(hasTokenData([point({ outputTokens: 1 })])).toBe(true);
  });
});

describe("cost donut", () => {
  const slice = (label: string, costUsd: number) => ({ label, costUsd });

  it("sorts descending and drops zero-cost slices", () => {
    const { slices, remainder } = costDonutSlices([
      slice("b", 1),
      slice("free", 0),
      slice("a", 5),
    ]);

    expect(slices).toEqual([slice("a", 5), slice("b", 1)]);
    expect(remainder).toBeNull();
  });

  it("collapses the tail once there are more slices than the cap", () => {
    const many = Array.from({ length: MAX_DONUT_SLICES + 3 }, (_, index) =>
      slice(`item-${index}`, MAX_DONUT_SLICES + 3 - index),
    );

    const { slices, remainder } = costDonutSlices(many);

    expect(slices).toHaveLength(MAX_DONUT_SLICES - 1);
    expect(remainder).not.toBeNull();
    expect(remainder?.count).toBe(4);
    // Nothing is lost: head + remainder still sums to the full spend.
    const total = many.reduce((sum, item) => sum + item.costUsd, 0);
    const shown =
      slices.reduce((sum, item) => sum + item.costUsd, 0) + (remainder?.costUsd ?? 0);
    expect(shown).toBe(total);
  });

  it("returns nothing to chart when every slice is zero", () => {
    expect(costDonutSlices([slice("a", 0)])).toEqual({ slices: [], remainder: null });
  });

  it("computes share to one decimal, and 0 for an empty total", () => {
    expect(sharePercent(1, 3)).toBe(33.3);
    expect(sharePercent(1, 0)).toBe(0);
  });
});
