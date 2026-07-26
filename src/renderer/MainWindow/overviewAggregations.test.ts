/**
 * @file overviewAggregations.test.ts
 * @description Pure unit tests for the Overview aggregation layer (#57). No
 * electron/sqlite/DOM. `now` is injected for determinism. Timestamps are built
 * from local-time Date components so local-day bucketing is stable regardless
 * of the runner's timezone.
 */
import { describe, expect, it } from "vitest";
import { estimateTextTokens, type HistoryEntry } from "~/stores/historyTypes";
import {
  activeDays,
  benchmarkMessage,
  costTotal,
  favoriteModel,
  filterByRange,
  heatmapBuckets,
  HOUR_BLOCKS,
  hourBlockHeatmap,
  sevenDayHourBlockHeatmap,
  intensityLevel,
  messageCount,
  peakHour,
  perPresetBreakdown,
  presetCountsOverTime,
  perPresetWeights,
  sessionCount,
  stripModelDate,
  streaks,
  tokenActivityCalendar,
  totalCorrections,
  totalTokens,
  type TokenActivityCalendar,
  UNTITLED_PRESET_ID,
} from "./overviewAggregations";

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

const dayCell = (
  calendar: TokenActivityCalendar,
  date: string
) => {
  const cell = calendar.cells.find(
    (candidate) => candidate.kind === "day" && candidate.date === date
  );
  expect(cell).toBeDefined();
  if (!cell || cell.kind !== "day") {
    throw new Error(`Missing day cell for ${date}`);
  }
  return cell;
};

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
  it("counts corrections and estimates missing token counts from input/output text", () => {
    const entries = [
      entry({ promptTokens: 100, completionTokens: 50 }),
      entry({ promptTokens: 10 }), // completion missing → estimate output
      entry({}), // both missing → estimate input + output
    ];
    expect(totalCorrections(entries)).toBe(3);
    expect(totalTokens(entries)).toBe(
      160 +
        estimateTextTokens(entries[1].corrected) +
        estimateTextTokens(entries[2].original) +
        estimateTextTokens(entries[2].corrected)
    );
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
  it("groups + sorts desc; undefined presetName → untitled bucket", () => {
    const entries = [
      entry({ presetName: "Correction" }),
      entry({ presetName: "Correction" }),
      entry({ presetName: "Translate" }),
      entry({ presetName: undefined }),
    ];
    const result = perPresetBreakdown(entries);
    expect(result[0]).toEqual({
      presetName: "Correction",
      presetLabel: { kind: "text", text: "Correction" },
      count: 2,
    });
    const other = result.find((r) => r.presetName === UNTITLED_PRESET_ID);
    expect(other?.count).toBe(1);
    expect(other?.presetLabel).toEqual({
      kind: "message",
      message: { key: "overview.preset.untitled" },
    });
  });
});

describe("perPresetWeights", () => {
  it("returns relative shares that sum to 1 and match counts", () => {
    const entries = [
      entry({ presetName: "Correction" }),
      entry({ presetName: "Correction" }),
      entry({ presetName: "Translate" }),
      entry({ presetName: undefined }),
    ];
    const result = perPresetWeights(entries);
    expect(result).toEqual([
      {
        presetName: "Correction",
        presetLabel: { kind: "text", text: "Correction" },
        count: 2,
        weight: 0.5,
      },
      {
        presetName: "Translate",
        presetLabel: { kind: "text", text: "Translate" },
        count: 1,
        weight: 0.25,
      },
      {
        presetName: UNTITLED_PRESET_ID,
        presetLabel: { kind: "message", message: { key: "overview.preset.untitled" } },
        count: 1,
        weight: 0.25,
      },
    ]);
    const sum = result.reduce((acc, row) => acc + row.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("returns [] for empty history", () => {
    expect(perPresetWeights([])).toEqual([]);
  });
});

describe("presetCountsOverTime", () => {
  it("builds dense per-day preset counts and daily totals", () => {
    const entries = [
      entry({ presetName: "Correction", timestamp: at(2024, 6, 18) }),
      entry({ presetName: "Correction", timestamp: at(2024, 6, 18) }),
      entry({ presetName: "Translate", timestamp: at(2024, 6, 20) }),
      entry({ presetName: undefined, timestamp: at(2024, 6, 20) }),
    ];
    const result = presetCountsOverTime(entries, "7d", NOW);
    expect(result.days).toHaveLength(7);
    expect(result.days[0]).toBe("2024-06-14");
    expect(result.days[6]).toBe("2024-06-20");

    const correction = result.series.find((row) => row.presetName === "Correction");
    const translate = result.series.find((row) => row.presetName === "Translate");
    const other = result.series.find((row) => row.presetName === UNTITLED_PRESET_ID);
    expect(correction?.counts).toEqual([0, 0, 0, 0, 2, 0, 0]);
    expect(translate?.counts).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(other?.counts).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(result.totalsByDay).toEqual([0, 0, 0, 0, 2, 0, 2]);
    expect(other?.presetLabel).toEqual({
      kind: "message",
      message: { key: "overview.preset.untitled" },
    });
  });

  it("returns empty series for empty history but still spans the range window", () => {
    const result = presetCountsOverTime([], "7d", NOW);
    expect(result.days).toHaveLength(7);
    expect(result.series).toEqual([]);
    expect(result.totalsByDay.every((count) => count === 0)).toBe(true);
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

describe("tokenActivityCalendar", () => {
  it("renders a rolling 12-month grid with Sunday-aligned leading placeholders and ends at today", () => {
    const calendar = tokenActivityCalendar([], "daily", NOW);

    expect(calendar.startDate).toBe("2023-06-21");
    expect(calendar.endDate).toBe("2024-06-20");
    expect(calendar.rows).toBe(7);
    expect(calendar.columns).toBe(53);

    expect(calendar.cells.slice(0, 3)).toEqual([
      {
        kind: "placeholder",
        date: null,
        tokenTotal: 0,
        correctionCount: 0,
        level: 0,
        column: 0,
        row: 0,
      },
      {
        kind: "placeholder",
        date: null,
        tokenTotal: 0,
        correctionCount: 0,
        level: 0,
        column: 0,
        row: 1,
      },
      {
        kind: "placeholder",
        date: null,
        tokenTotal: 0,
        correctionCount: 0,
        level: 0,
        column: 0,
        row: 2,
      },
    ]);
    expect(calendar.cells[3]).toMatchObject({
      kind: "day",
      date: "2023-06-21",
      column: 0,
      row: 3,
    });
    expect(calendar.cells.at(-1)).toMatchObject({
      kind: "day",
      date: "2024-06-20",
    });
  });

  it("daily mode sums prompt + completion tokens per local day and counts corrections", () => {
    const calendar = tokenActivityCalendar(
      [
        entry({
          timestamp: at(2024, 6, 18, 9),
          promptTokens: 10,
          completionTokens: 5,
        }),
        entry({
          timestamp: at(2024, 6, 18, 14),
          promptTokens: 3,
          completionTokens: 2,
        }),
        entry({
          timestamp: at(2024, 6, 19, 11),
          promptTokens: 7,
        }),
      ],
      "daily",
      NOW
    );

    expect(dayCell(calendar, "2024-06-18")).toMatchObject({
      tokenTotal: 20,
      correctionCount: 2,
    });
    expect(dayCell(calendar, "2024-06-19")).toMatchObject({
      tokenTotal: 7 + estimateTextTokens("c"),
      correctionCount: 1,
    });
    expect(dayCell(calendar, "2024-06-17")).toMatchObject({
      tokenTotal: 0,
      correctionCount: 0,
    });
  });

  it("weekly mode applies the same Sunday-start week totals to each visible day in that week", () => {
    const calendar = tokenActivityCalendar(
      [
        entry({
          timestamp: at(2024, 6, 16, 8),
          promptTokens: 10,
          completionTokens: 5,
        }),
        entry({
          timestamp: at(2024, 6, 18, 12),
          promptTokens: 7,
          completionTokens: 3,
        }),
      ],
      "weekly",
      NOW
    );

    for (const date of [
      "2024-06-16",
      "2024-06-17",
      "2024-06-18",
      "2024-06-20",
    ]) {
      expect(dayCell(calendar, date)).toMatchObject({
        tokenTotal: 25,
        correctionCount: 2,
      });
    }
    expect(dayCell(calendar, "2024-06-09")).toMatchObject({
      tokenTotal: 0,
      correctionCount: 0,
    });
  });

  it("cumulative mode includes totals from before the visible 12-month window", () => {
    const calendar = tokenActivityCalendar(
      [
        entry({
          timestamp: at(2023, 6, 20, 12),
          promptTokens: 7,
          completionTokens: 3,
        }),
        entry({
          timestamp: at(2023, 6, 22, 12),
          promptTokens: 5,
          completionTokens: 0,
        }),
      ],
      "cumulative",
      NOW
    );

    expect(dayCell(calendar, "2023-06-21")).toMatchObject({
      tokenTotal: 10,
      correctionCount: 1,
    });
    expect(dayCell(calendar, "2023-06-22")).toMatchObject({
      tokenTotal: 15 + estimateTextTokens("c"),
      correctionCount: 2,
    });
  });

  it("skips the partial first month label so adjacent edge months do not overlap", () => {
    const calendar = tokenActivityCalendar(
      [],
      "daily",
      new Date(2026, 5, 22, 10, 0, 0)
    );

    expect(calendar.startDate).toBe("2025-06-23");
    expect(calendar.monthLabels[0]).toEqual({ key: "charts.month.jul", column: 1 });
    expect(
      calendar.monthLabels.some(
        (label) => label.key === "charts.month.jun" && label.column === 0
      )
    ).toBe(false);
  });

  it("exposes month labels with translation keys and week-column positions", () => {
    const monthEndNow = new Date(2024, 5, 30, 10, 0, 0);
    const calendar = tokenActivityCalendar([], "daily", monthEndNow);

    expect(calendar.monthLabels).toEqual([
      { key: "charts.month.jul", column: 0 },
      { key: "charts.month.aug", column: 5 },
      { key: "charts.month.sep", column: 9 },
      { key: "charts.month.oct", column: 14 },
      { key: "charts.month.nov", column: 18 },
      { key: "charts.month.dec", column: 22 },
      { key: "charts.month.jan", column: 27 },
      { key: "charts.month.feb", column: 31 },
      { key: "charts.month.mar", column: 35 },
      { key: "charts.month.apr", column: 40 },
      { key: "charts.month.may", column: 44 },
      { key: "charts.month.jun", column: 48 },
    ]);
  });

  it("scales visible day intensity levels from 0 to 4 using the window max token total", () => {
    const calendar = tokenActivityCalendar(
      [
        entry({
          timestamp: at(2024, 6, 17, 10),
          promptTokens: 24,
          completionTokens: 1,
        }),
        entry({
          timestamp: at(2024, 6, 18, 10),
          promptTokens: 49,
          completionTokens: 1,
        }),
        entry({
          timestamp: at(2024, 6, 19, 10),
          promptTokens: 74,
          completionTokens: 1,
        }),
        entry({
          timestamp: at(2024, 6, 20, 10),
          promptTokens: 99,
          completionTokens: 1,
        }),
      ],
      "daily",
      NOW
    );

    expect(calendar.maxTokenTotal).toBe(100);
    expect(dayCell(calendar, "2024-06-16").level).toBe(0);
    expect(dayCell(calendar, "2024-06-17").level).toBe(1);
    expect(dayCell(calendar, "2024-06-18").level).toBe(2);
    expect(dayCell(calendar, "2024-06-19").level).toBe(3);
    expect(dayCell(calendar, "2024-06-20").level).toBe(4);
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
    // Window is floored to >=30 days ending today regardless of range.
    expect(hm.days.length).toBeGreaterThanOrEqual(30);
    expect(hm.cells[0]).toHaveLength(HOUR_BLOCKS);
    const lastDay = hm.cells.length - 1; // today = 2024-06-20
    expect(hm.cells[lastDay][0]).toBe(2);
    expect(hm.cells[lastDay][5]).toBe(1);
    expect(hm.max).toBe(2);
  });
});

describe("benchmarkMessage", () => {
  it("reports an empty descriptor when there is no usage", () => {
    expect(benchmarkMessage(0)).toEqual({ key: "overview.benchmark.empty" });
  });

  it("reports an empty descriptor for negative tokens (tokens <= 0 guard)", () => {
    expect(benchmarkMessage(-5)).toEqual({ key: "overview.benchmark.empty" });
  });

  it("reports headroom below the reference budget", () => {
    expect(benchmarkMessage(50_000, 100_000)).toEqual({
      key: "overview.benchmark.withHeadroom",
      params: { tokens: 50_000, pct: 50, budgetK: 100, headroom: 50 },
    });
  });

  it("reports over-budget above the reference budget", () => {
    expect(benchmarkMessage(150_000, 100_000)).toEqual({
      key: "overview.benchmark.overBudget",
      params: { tokens: 150_000, pct: 150, budgetK: 100 },
    });
  });

  it("treats exactly 100% as over-budget (the >= boundary)", () => {
    expect(benchmarkMessage(100_000, 100_000)).toEqual({
      key: "overview.benchmark.overBudget",
      params: { tokens: 100_000, pct: 100, budgetK: 100 },
    });
  });

  it("rounds the percentage (Math.round)", () => {
    expect(benchmarkMessage(1_234, 100_000)).toEqual({
      key: "overview.benchmark.withHeadroom",
      params: { tokens: 1_234, pct: 1, budgetK: 100, headroom: 99 },
    });
  });

  it("rounds half-up", () => {
    expect(benchmarkMessage(1_500, 100_000)).toEqual({
      key: "overview.benchmark.withHeadroom",
      params: { tokens: 1_500, pct: 2, budgetK: 100, headroom: 98 },
    });
  });

  it("computes budgetK as benchmark/1000, unrounded", () => {
    expect(benchmarkMessage(50_000, 500)).toEqual({
      key: "overview.benchmark.overBudget",
      params: { tokens: 50_000, pct: 10_000, budgetK: 0.5 },
    });
  });
});

describe("sevenDayHourBlockHeatmap", () => {
  it("renders exactly 7 day columns ending today", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 20, 9) }),
      entry({ timestamp: at(2024, 6, 14, 9) }),
    ];
    const hm = sevenDayHourBlockHeatmap(entries, NOW);
    expect(hm.days).toHaveLength(7);
    expect(hm.days.at(-1)).toBe("2024-06-20");
    expect(hm.days[0]).toBe("2024-06-14");
  });

  it("places entries into the correct day column and hour block", () => {
    const entries = [
      entry({ timestamp: at(2024, 6, 20, 1) }),
      entry({ timestamp: at(2024, 6, 20, 21) }),
    ];
    const hm = sevenDayHourBlockHeatmap(entries, NOW);
    const lastDay = hm.days.length - 1;
    expect(hm.cells[lastDay][0]).toBe(1);
    expect(hm.cells[lastDay][5]).toBe(1);
    expect(hm.max).toBe(1);
  });
});
describe("hourBlockHeatmap window floor + width", () => {
  it("shows >=30 day columns even with a single day of history (any range)", () => {
    const one = [entry({ timestamp: at(2024, 6, 20, 9) })];
    expect(hourBlockHeatmap(one, "all", NOW).days.length).toBeGreaterThanOrEqual(30);
    expect(hourBlockHeatmap(one, "7d", NOW).days.length).toBeGreaterThanOrEqual(30);
    expect(hourBlockHeatmap(one, "all", NOW).days.at(-1)).toBe("2024-06-20");
  });
  it("widens to the requested column count (width-driven minDays)", () => {
    const hm = hourBlockHeatmap([entry({ timestamp: at(2024, 6, 20) })], "7d", NOW, 100);
    expect(hm.days).toHaveLength(100);
  });
  it("never shrinks below the 30-day floor when fewer columns are requested", () => {
    const hm = hourBlockHeatmap([entry({ timestamp: at(2024, 6, 20) })], "7d", NOW, 5);
    expect(hm.days).toHaveLength(30);
  });
});

describe("stripModelDate", () => {
  it("strips a trailing YYYYMMDD date", () => {
    expect(stripModelDate("openai/gpt-5.4-mini-20260317")).toBe(
      "openai/gpt-5.4-mini"
    );
  });
  it("strips a trailing dashed YYYY-MM-DD date", () => {
    expect(stripModelDate("gpt-5.4-mini-2026-03-17")).toBe("gpt-5.4-mini");
  });
  it("leaves ids without a trailing date unchanged", () => {
    expect(stripModelDate("openai/gpt-4o")).toBe("openai/gpt-4o");
    expect(stripModelDate("claude-3.5")).toBe("claude-3.5");
  });
  it("null stays null", () => {
    expect(stripModelDate(null)).toBeNull();
  });
});
