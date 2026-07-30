/**
 * @file tokenActivityView.test.ts
 * @description Unit tests for the pure Overview token-activity view helpers
 * (Chunk 8). Descriptor shape is asserted directly; rendered strings are
 * asserted through `createTranslator` (EN + JA) so this file also covers the
 * `overview.tokenActivity.*` catalog entries end to end, without a DOM
 * testing library (none is installed).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetFormatCachesForTests,
  createFormatters,
} from "~/features/i18n/shared/format";
import { resolveMessage, type Message } from "~/features/i18n/shared/message";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  dayKeyDateFormatter,
  peakHourMessage,
  STAT_CARD_KEYS,
  TOKEN_ACTIVITY_TABS,
  tooltipMessageForCell,
  weeklyRangeOf,
} from "./tokenActivityView";
import type { TokenActivityCalendarCell } from "../MainWindow/overviewAggregations";

/** Asserts a `Message | undefined` is defined and narrows it, without a non-null assertion. */
const requireMessage = (message: Message | undefined): Message => {
  expect(message).toBeDefined();
  if (!message) {
    throw new Error("expected tooltipMessageForCell to return a Message");
  }
  return message;
};

const identityFmt = { date: (dayKey: string) => dayKey };

type DayCell = Extract<TokenActivityCalendarCell, { kind: "day" }>;

const dayCell = (overrides: Partial<DayCell> = {}): TokenActivityCalendarCell => ({
  kind: "day",
  date: "2024-06-18",
  tokenTotal: 1234,
  correctionCount: 0,
  level: 0,
  column: 0,
  row: 0,
  ...overrides,
});

const placeholderCell: TokenActivityCalendarCell = {
  kind: "placeholder",
  date: null,
  tokenTotal: 0,
  correctionCount: 0,
  level: 0,
  column: 0,
  row: 0,
};

describe("TOKEN_ACTIVITY_TABS", () => {
  it("has 3 modes with translation keys, daily/weekly/cumulative in order", () => {
    expect(TOKEN_ACTIVITY_TABS.map((tab) => tab.mode)).toEqual([
      "daily",
      "weekly",
      "cumulative",
    ]);
    expect(TOKEN_ACTIVITY_TABS.map((tab) => tab.labelKey)).toEqual([
      "overview.tokenActivity.mode.daily",
      "overview.tokenActivity.mode.weekly",
      "overview.tokenActivity.mode.cumulative",
    ]);
  });
});

describe("STAT_CARD_KEYS", () => {
  it("maps every stat card to its overview.stat.* key", () => {
    expect(STAT_CARD_KEYS).toEqual({
      messages: "overview.stat.messages",
      totalTokens: "overview.stat.totalTokens",
      activeDays: "overview.stat.activeDays",
      streaks: "overview.stat.streaks",
      peakHour: "overview.stat.peakHour",
      favoriteModel: "overview.stat.favoriteModel",
    });
  });
});

describe("weeklyRangeOf", () => {
  it("returns the Sunday-start week window for a mid-week day key", () => {
    // 2024-06-18 is a Tuesday; the containing week runs Sun 06-16 .. Sat 06-22.
    expect(weeklyRangeOf("2024-06-18")).toEqual({ start: "2024-06-16", end: "2024-06-22" });
  });

  it("a Sunday day key is its own week start", () => {
    expect(weeklyRangeOf("2024-06-16")).toEqual({ start: "2024-06-16", end: "2024-06-22" });
  });

  it("a Saturday day key is its own week end", () => {
    expect(weeklyRangeOf("2024-06-22")).toEqual({ start: "2024-06-16", end: "2024-06-22" });
  });
});

describe("peakHourMessage", () => {
  it("null → the empty-value chrome", () => {
    expect(peakHourMessage(null)).toEqual({ key: "overview.value.empty" });
  });

  it("formats a 2-hour range with zero-padded hours", () => {
    expect(peakHourMessage(9)).toEqual({
      key: "overview.value.hour",
      params: { start: "09", end: "11" },
    });
  });

  it("wraps midnight for a late-night window", () => {
    expect(peakHourMessage(23)).toEqual({
      key: "overview.value.hour",
      params: { start: "23", end: "01" },
    });
  });
});

describe("tooltipMessageForCell", () => {
  it("returns undefined for a placeholder cell in every mode", () => {
    expect(tooltipMessageForCell("daily", placeholderCell, identityFmt)).toBeUndefined();
    expect(tooltipMessageForCell("weekly", placeholderCell, identityFmt)).toBeUndefined();
    expect(tooltipMessageForCell("cumulative", placeholderCell, identityFmt)).toBeUndefined();
  });

  describe("daily mode", () => {
    it("no corrections → the base tooltip key", () => {
      const cell = dayCell({ tokenTotal: 500, correctionCount: 0 });
      expect(tooltipMessageForCell("daily", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.daily",
        params: { tokens: 500, date: "2024-06-18" },
      });
    });

    it("1 correction → the singular withCorrections base key", () => {
      const cell = dayCell({ tokenTotal: 500, correctionCount: 1 });
      expect(tooltipMessageForCell("daily", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.daily.withCorrections",
        params: { tokens: 500, date: "2024-06-18", count: 1 },
      });
    });

    it("N corrections → the same withCorrections base key (plural selected at render)", () => {
      const cell = dayCell({ tokenTotal: 500, correctionCount: 4 });
      expect(tooltipMessageForCell("daily", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.daily.withCorrections",
        params: { tokens: 500, date: "2024-06-18", count: 4 },
      });
    });
  });

  describe("weekly mode", () => {
    it("no corrections → resolves the Sunday-start week window through fmt.date", () => {
      const cell = dayCell({ date: "2024-06-18", tokenTotal: 700, correctionCount: 0 });
      expect(tooltipMessageForCell("weekly", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.weekly",
        params: { tokens: 700, start: "2024-06-16", end: "2024-06-22" },
      });
    });

    it("1 correction → the singular withCorrections base key", () => {
      const cell = dayCell({ date: "2024-06-18", tokenTotal: 700, correctionCount: 1 });
      expect(tooltipMessageForCell("weekly", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.weekly.withCorrections",
        params: { tokens: 700, start: "2024-06-16", end: "2024-06-22", count: 1 },
      });
    });

    it("N corrections → withCorrections base key with the count param", () => {
      const cell = dayCell({ date: "2024-06-18", tokenTotal: 700, correctionCount: 3 });
      expect(tooltipMessageForCell("weekly", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.weekly.withCorrections",
        params: { tokens: 700, start: "2024-06-16", end: "2024-06-22", count: 3 },
      });
    });
  });

  describe("cumulative mode", () => {
    it("no corrections → the base tooltip key", () => {
      const cell = dayCell({ tokenTotal: 9000, correctionCount: 0 });
      expect(tooltipMessageForCell("cumulative", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.cumulative",
        params: { tokens: 9000, date: "2024-06-18" },
      });
    });

    it("1 correction → the singular withCorrections base key", () => {
      const cell = dayCell({ tokenTotal: 9000, correctionCount: 1 });
      expect(tooltipMessageForCell("cumulative", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.cumulative.withCorrections",
        params: { tokens: 9000, date: "2024-06-18", count: 1 },
      });
    });

    it("N corrections → the same withCorrections base key", () => {
      const cell = dayCell({ tokenTotal: 9000, correctionCount: 5 });
      expect(tooltipMessageForCell("cumulative", cell, identityFmt)).toEqual({
        key: "overview.tokenActivity.tooltip.cumulative.withCorrections",
        params: { tokens: 9000, date: "2024-06-18", count: 5 },
      });
    });
  });
});

describe("rendered tooltip strings (EN + JA)", () => {
  const fmt = { date: (dayKey: string) => dayKey };

  it("daily, no corrections", () => {
    const message = requireMessage(
      tooltipMessageForCell("daily", dayCell({ tokenTotal: 1500, correctionCount: 0 }), fmt),
    );
    expect(resolveMessage(message, createTranslator("en"))).toBe(
      "1,500 tokens on 2024-06-18",
    );
    expect(resolveMessage(message, createTranslator("ja"))).toBe(
      "2024-06-18 に 1,500 トークン",
    );
  });

  it("daily, singular vs plural corrections (ja collapses both to _other)", () => {
    const one = requireMessage(
      tooltipMessageForCell("daily", dayCell({ tokenTotal: 10, correctionCount: 1 }), fmt),
    );
    const many = requireMessage(
      tooltipMessageForCell("daily", dayCell({ tokenTotal: 10, correctionCount: 3 }), fmt),
    );

    expect(resolveMessage(one, createTranslator("en"))).toBe(
      "10 tokens on 2024-06-18, 1 transform",
    );
    expect(resolveMessage(many, createTranslator("en"))).toBe(
      "10 tokens on 2024-06-18, 3 transforms",
    );
    expect(resolveMessage(one, createTranslator("ja"))).toBe(
      "2024-06-18 に 10 トークン、1 件の変換",
    );
    expect(resolveMessage(many, createTranslator("ja"))).toBe(
      "2024-06-18 に 10 トークン、3 件の変換",
    );
  });

  it("weekly", () => {
    const message = requireMessage(
      tooltipMessageForCell(
        "weekly",
        dayCell({ date: "2024-06-18", tokenTotal: 42, correctionCount: 0 }),
        fmt,
      ),
    );
    expect(resolveMessage(message, createTranslator("en"))).toBe(
      "42 tokens during 2024-06-16 to 2024-06-22",
    );
    expect(resolveMessage(message, createTranslator("ja"))).toBe(
      "2024-06-16〜2024-06-22 に 42 トークン",
    );
  });

  it("cumulative", () => {
    const message = requireMessage(
      tooltipMessageForCell("cumulative", dayCell({ tokenTotal: 99, correctionCount: 0 }), fmt),
    );
    expect(resolveMessage(message, createTranslator("en"))).toBe(
      "99 tokens through 2024-06-18",
    );
    expect(resolveMessage(message, createTranslator("ja"))).toBe(
      "2024-06-18 までに累計 99 トークン",
    );
  });
});

describe("dayKeyDateFormatter", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
    __resetFormatCachesForTests();
  });

  it("formats a day key through the locale-aware formatDate, differing between en and ja, never the raw key", () => {
    const dayKey = "2024-06-18";
    const enLabel = dayKeyDateFormatter(createFormatters("en").formatDate).date(dayKey);
    const jaLabel = dayKeyDateFormatter(createFormatters("ja").formatDate).date(dayKey);

    expect(enLabel).not.toBe(dayKey);
    expect(jaLabel).not.toBe(dayKey);
    expect(enLabel).not.toBe(jaLabel);
    // Regression guard for Bug A (identity formatter): a locale-formatted
    // label never contains the dense ISO day key verbatim.
    expect(enLabel).not.toContain(dayKey);
    expect(jaLabel).not.toContain(dayKey);
  });

  it("this drives the real tooltipMessageForCell call site end to end (both locales)", () => {
    const cell = dayCell({ date: "2024-06-18", tokenTotal: 500, correctionCount: 0 });
    const enMessage = requireMessage(
      tooltipMessageForCell("daily", cell, dayKeyDateFormatter(createFormatters("en").formatDate)),
    );
    const jaMessage = requireMessage(
      tooltipMessageForCell("daily", cell, dayKeyDateFormatter(createFormatters("ja").formatDate)),
    );

    const enText = resolveMessage(enMessage, createTranslator("en"));
    const jaText = resolveMessage(jaMessage, createTranslator("ja"));
    expect(enText).not.toBe(jaText);
    expect(enText).not.toContain("2024-06-18");
    expect(jaText).not.toContain("2024-06-18");
  });

  it("keeps the calendar day correct in a negative-offset timezone (guards the UTC-midnight ISO-parse hazard)", () => {
    // "Pacific/Midway" is UTC-11. Handing the raw day key to `new
    // Date(dayKey)` parses it as UTC midnight, which renders as the
    // *previous* calendar day once formatted here — exactly the hazard
    // `dateFromDayKey`'s local (`new Date(y, m - 1, d)`) construction avoids.
    process.env.TZ = "Pacific/Midway";
    __resetFormatCachesForTests();

    const { formatDate } = createFormatters("en");
    const correct = dayKeyDateFormatter(formatDate).date("2026-01-01");
    const buggy = formatDate(new Date("2026-01-01"), { month: "short", day: "numeric" });

    expect(correct).toBe("Jan 1");
    expect(buggy).toBe("Dec 31");
    expect(correct).not.toBe(buggy);
  });
});
