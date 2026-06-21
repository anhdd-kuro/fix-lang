/**
 * @file overviewAggregations.test.ts
 * @description Pure unit tests for the Overview aggregation layer (#57). No
 * electron/sqlite/DOM. `now` is injected for determinism. Timestamps are built
 * from local-time Date components so local-day bucketing is stable regardless
 * of the runner's timezone.
 */
import { describe, expect, it } from "vitest";
import {
  activeDays,
  benchmarkSentence,
  costTotal,
  favoriteModel,
  filterByRange,
  heatmapBuckets,
  HOUR_BLOCKS,
  hourBlockHeatmap,
  intensityLevel,
  messageCount,
  peakHour,
  perPresetBreakdown,
  sessionCount,
  splitModelId,
  streaks,
  totalCorrections,
  totalTokens,
  UNTITLED_PRESET_LABEL,
} from "./overviewAggregations";
import type { HistoryEntry } from "~/stores/historyStore";

// A local-time timestamp for the given Y/M/D/H so local-day buckets are stable.
const at = (
  year: number,
  month: number,
  day: number,
  hour = 12
): string => new Date(year, month - 1, day, hour, 0, 0).toISOString();

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  original: "o",
  corrected: "c",
  timestamp: at(2024, 6, 15),
  ...overrides,
});

const NOW = new Date(2024, 5, 20, 10, 0, 0); // 2024-06-20 10:00 local

describe("filterByRange", () => {
  const entries = [
    entry({ timestamp: at(2024, 6, 20) }), // today
    entry({ timestamp: at(2024, 6, 14) }), // 6 days ago
    entry({ timestamp: at(2024, 5, 25) }), // ~26 days ago
    entry({ timestamp: at(2024, 1, 1) }), // far past
  ];

  it("returns all entries for 'all'", () => {
    expect(filterByRange(entries, "all", NOW)).toHaveLength(4);
  });

  it("7d keeps only entries within the last 7 days", () => {
    const result = filterByRange(entries, "7d", NOW);
    // today + 6-days-ago are within 7d; the others are not.
    expect(result).toHaveLength(2);
  });

  it("30d keeps entries within the last 30 days (boundary inclusive)", () => {
    const result = filterByRange(entries, "30d", NOW);
    expect(result).toHaveLength(3); // excludes only the Jan 1 entry
  });
});

describe("totalCorrections / totalTokens", () => {
  it("counts corrections and sums tokens, treating missing tokens as 0", () => {
    const entries = [
      entry({ promptTokens: 100, completionTokens: 50 }),
      entry({ promptTokens: 10 }), // completion missing → 0
      entry({}), // both missing → 0
    ];
    expect(totalCorrections(entries)).toBe(3);
    expect(totalTokens(entries)).toBe(160);
  });
});

describe("costTotal (N/A-aware)", () => {
  it("sums only ok/zero, excludes na/absent, and reports hasNa", () => {
    const entries = [
      entry({ costStatus: "ok", estimatedCostUsd: 0.006 }),
      entry({ costStatus: "zero", estimatedCostUsd: 0 }),
      entry({ costStatus: "na", estimatedCostUsd: undefined }),
      entry({}), // absent cost → treated as N/A
    ];
    const result = costTotal(entries);
    expect(result.totalUsd).toBeCloseTo(0.006, 10);
    expect(result.pricedCount).toBe(2);
    expect(result.total).toBe(4);
    expect(result.hasNa).toBe(true);
  });

  it("hasNa is false when every entry is priced", () => {
    const result = costTotal([
      entry({ costStatus: "ok", estimatedCostUsd: 1 }),
      entry({ costStatus: "zero", estimatedCostUsd: 0 }),
    ]);
    expect(result.hasNa).toBe(false);
    expect(result.pricedCount).toBe(2);
  });
});

describe("activeDays", () => {
  it("counts each local day once regardless of multiple corrections", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 15, 9) }),
      entry({ timestamp: at(2024, 6, 15, 14) }),
      entry({ timestamp: at(2024, 6, 16, 10) }),
    ];
    expect(activeDays(entries)).toBe(2);
  });
});

describe("streaks", () => {
  it("empty → {0,0}", () => {
    expect(streaks([], NOW)).toEqual({ current: 0, longest: 0 });
  });

  it("current counts back from today; longest spans the max consecutive run", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 20) }), // today
      entry({ timestamp: at(2024, 6, 19) }), // yesterday
      entry({ timestamp: at(2024, 6, 18) }), // day before
      // gap on 6/17
      entry({ timestamp: at(2024, 6, 10) }),
    ];
    const result = streaks(entries, NOW);
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it("current allows starting at yesterday when today is inactive", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 19) }),
      entry({ timestamp: at(2024, 6, 18) }),
    ];
    expect(streaks(entries, NOW).current).toBe(2);
  });

  it("a gap resets the current streak to 0 when neither today nor yesterday active", () => {
    const entries = [entry({ timestamp: at(2024, 6, 10) })];
    expect(streaks(entries, NOW).current).toBe(0);
  });
});

describe("peakHour", () => {
  it("returns the busiest hour; empty → null", () => {
    expect(peakHour([])).toBeNull();
    const entries = [
      entry({ timestamp: at(2024, 6, 15, 9) }),
      entry({ timestamp: at(2024, 6, 16, 9) }),
      entry({ timestamp: at(2024, 6, 17, 14) }),
    ];
    expect(peakHour(entries)).toBe(9);
  });

  it("resolves ties to the lowest hour", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 15, 8) }),
      entry({ timestamp: at(2024, 6, 16, 20) }),
    ];
    expect(peakHour(entries)).toBe(8);
  });
});

describe("favoriteModel", () => {
  it("returns the most-frequent resolvedModel, preferring it over model", () => {
    const entries = [
      entry({ model: "alias", resolvedModel: "openai/gpt-4o" }),
      entry({ model: "alias", resolvedModel: "openai/gpt-4o" }),
      entry({ model: "anthropic/claude" }),
    ];
    expect(favoriteModel(entries)).toBe("openai/gpt-4o");
  });

  it("excludes undefined/empty model ids; empty → null", () => {
    expect(favoriteModel([entry({ model: undefined })])).toBeNull();
    expect(favoriteModel([])).toBeNull();
  });
});

describe("perPresetBreakdown", () => {
  it("groups + sorts desc; undefined presetName → Other bucket", () => {
    const entries = [
      entry({ presetName: "Correction" }),
      entry({ presetName: "Correction" }),
      entry({ presetName: "Translate" }),
      entry({ presetName: undefined }),
    ];
    const result = perPresetBreakdown(entries);
    expect(result[0]).toEqual({ presetName: "Correction", count: 2 });
    const other = result.find((r) => r.presetName === UNTITLED_PRESET_LABEL);
    expect(other?.count).toBe(1);
  });
});

describe("heatmapBuckets", () => {
  it("produces a dense day range with zero-count empty days (7d)", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 20) }),
      entry({ timestamp: at(2024, 6, 20) }),
      entry({ timestamp: at(2024, 6, 18) }),
    ];
    const buckets = heatmapBuckets(entries, "7d", NOW);
    expect(buckets).toHaveLength(7); // last 7 days inclusive
    const today = buckets.find((b) => b.date === "2024-06-20");
    const empty = buckets.find((b) => b.date === "2024-06-19");
    expect(today?.count).toBe(2);
    expect(empty?.count).toBe(0);
  });

  it("'all' spans earliest entry day → today", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 18) }),
      entry({ timestamp: at(2024, 6, 20) }),
    ];
    const buckets = heatmapBuckets(entries, "all", NOW);
    expect(buckets[0].date).toBe("2024-06-18");
    expect(buckets[buckets.length - 1].date).toBe("2024-06-20");
    expect(buckets).toHaveLength(3);
  });

  it("'all' with no entries renders a single today bucket", () => {
    const buckets = heatmapBuckets([], "all", NOW);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({ date: "2024-06-20", count: 0 });
  });
});

describe("intensityLevel", () => {
  it("maps counts to 0–4 buckets scaled to max", () => {
    expect(intensityLevel(0, 8)).toBe(0);
    expect(intensityLevel(2, 8)).toBe(1); // 0.25
    expect(intensityLevel(4, 8)).toBe(2); // 0.5
    expect(intensityLevel(6, 8)).toBe(3); // 0.75
    expect(intensityLevel(8, 8)).toBe(4); // 1.0
  });
  it("returns 0 when max is 0", () => {
    expect(intensityLevel(0, 0)).toBe(0);
  });
});

describe("sessionCount", () => {
  it("returns 0 for no entries and 1 for a single entry", () => {
    expect(sessionCount([])).toBe(0);
    expect(sessionCount([entry()])).toBe(1);
  });
  it("splits into a new session when the idle gap exceeds the threshold", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 15, 9) }),
      entry({ timestamp: at(2024, 6, 15, 9) }), // same hour → same session
      entry({ timestamp: at(2024, 6, 15, 14) }), // +5h → new session
      entry({ timestamp: at(2024, 6, 16, 14) }), // next day → new session
    ];
    expect(sessionCount(entries, 30)).toBe(3);
  });
});

describe("messageCount", () => {
  it("counts one message per entry", () => {
    expect(messageCount([])).toBe(0);
    expect(messageCount([entry(), entry(), entry()])).toBe(3);
  });
});

describe("hourBlockHeatmap", () => {
  it("places entries into the correct day column and 4-hour block row", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 20, 1) }), // block 0 (00–04)
      entry({ timestamp: at(2024, 6, 20, 2) }), // block 0
      entry({ timestamp: at(2024, 6, 20, 21) }), // block 5 (20–24)
    ];
    const hm = hourBlockHeatmap(entries, "7d", NOW);
    expect(hm.days).toHaveLength(7);
    expect(hm.cells[0]).toHaveLength(HOUR_BLOCKS);
    const lastDay = hm.cells.length - 1; // today = 2024-06-20
    expect(hm.cells[lastDay][0]).toBe(2);
    expect(hm.cells[lastDay][5]).toBe(1);
    expect(hm.max).toBe(2);
  });
});

describe("benchmarkSentence", () => {
  it("reports an empty message when there is no usage", () => {
    expect(benchmarkSentence(0)).toBe("No token usage in this range yet.");
  });
  it("reports a percentage of the reference budget", () => {
    expect(benchmarkSentence(50_000, 100_000)).toContain("50%");
    expect(benchmarkSentence(150_000, 100_000)).toContain("150%");
  });
});

describe("splitModelId", () => {
  it("splits provider/model on the first slash", () => {
    expect(splitModelId("openai/gpt-4o")).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(splitModelId("anthropic/claude/opus")).toEqual({
      provider: "anthropic",
      model: "claude/opus",
    });
  });
  it("no slash → provider null, model = whole id", () => {
    expect(splitModelId("gpt-4o")).toEqual({ provider: null, model: "gpt-4o" });
  });
  it("null/blank → both null", () => {
    expect(splitModelId(null)).toEqual({ provider: null, model: null });
    expect(splitModelId("   ")).toEqual({ provider: null, model: null });
  });
});

describe("hourBlockHeatmap default-range floor", () => {
  it("'all' shows >=30 day columns even with a single day of history", () => {
    const hm = hourBlockHeatmap([entry({ timestamp: at(2024, 6, 20, 9) })], "all", NOW);
    expect(hm.days.length).toBeGreaterThanOrEqual(30);
    expect(hm.days[hm.days.length - 1]).toBe("2024-06-20");
  });
  it("'7d' keeps the exact 7-day window (no floor)", () => {
    const hm = hourBlockHeatmap([entry({ timestamp: at(2024, 6, 20, 9) })], "7d", NOW);
    expect(hm.days).toHaveLength(7);
  });
});
