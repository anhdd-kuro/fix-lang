import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __peekFormatCachesForTests,
  __resetFormatCachesForTests,
  createFormatters,
  dateFnsLocaleFor,
} from "./format";

describe("createFormatters", () => {
  // The Intl/formatter caches are module-level singletons by design, so
  // every test starts from a clean slate — otherwise cache-hit/miss
  // assertions would depend on suite execution order.
  beforeEach(() => {
    __resetFormatCachesForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatDate", () => {
    const sample = new Date("2026-03-05T10:00:00Z");

    it("renders EN and JA differently for the same date, both non-empty", () => {
      const en = createFormatters("en").formatDate(sample);
      const ja = createFormatters("ja").formatDate(sample);

      expect(en).not.toBe("");
      expect(ja).not.toBe("");
      expect(en).not.toBe(ja);
    });

    it("returns '' for an unparseable Date object", () => {
      expect(createFormatters("en").formatDate(new Date("nope"))).toBe("");
      expect(createFormatters("ja").formatDate(new Date("nope"))).toBe("");
    });

    it("returns '' for an unparseable string", () => {
      expect(createFormatters("en").formatDate("garbage")).toBe("");
    });

    it("returns '' for NaN / Infinity numeric input", () => {
      expect(createFormatters("en").formatDate(Number.NaN)).toBe("");
      expect(createFormatters("en").formatDate(Number.POSITIVE_INFINITY)).toBe("");
    });
  });

  describe("formatDateTime", () => {
    it("is non-empty for a valid date and '' for invalid input", () => {
      const { formatDateTime } = createFormatters("en");
      expect(formatDateTime(new Date("2026-03-05T10:00:00Z"))).not.toBe("");
      expect(formatDateTime(new Date("nope"))).toBe("");
      expect(formatDateTime("garbage")).toBe("");
      expect(formatDateTime(Number.NaN)).toBe("");
      expect(formatDateTime(Number.POSITIVE_INFINITY)).toBe("");
    });
  });

  describe("formatNumber / formatCompactNumber", () => {
    it("formatNumber(1234567) contains grouping separators", () => {
      const { formatNumber } = createFormatters("en");
      const result = formatNumber(1234567);
      // Grouping separator can be "," (en) or a locale-specific char; just
      // assert the plain digit string doesn't survive verbatim.
      expect(result).not.toBe("1234567");
      expect(result.length).toBeGreaterThan("1234567".length);
    });

    it("formatCompactNumber is shorter than the plain form for a large value", () => {
      const en = createFormatters("en");
      const ja = createFormatters("ja");

      expect(en.formatCompactNumber(1234567).length).toBeLessThan(
        en.formatNumber(1234567).length,
      );
      expect(ja.formatCompactNumber(1234567).length).toBeLessThan(
        ja.formatNumber(1234567).length,
      );
    });

    it("returns '' for NaN / Infinity", () => {
      const { formatNumber, formatCompactNumber } = createFormatters("en");
      expect(formatNumber(Number.NaN)).toBe("");
      expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("");
      expect(formatCompactNumber(Number.NaN)).toBe("");
      expect(formatCompactNumber(Number.NEGATIVE_INFINITY)).toBe("");
    });
  });

  describe("formatCurrency", () => {
    it("formats USD with a $ sign", () => {
      expect(createFormatters("en").formatCurrency(12.3, "USD")).toContain("$");
    });

    it("formats JPY with a ¥ sign and no decimal fraction", () => {
      const result = createFormatters("en").formatCurrency(1200, "JPY");
      expect(result).toContain("¥");
      expect(result).not.toMatch(/\.\d/);
    });

    it("defaults currency to USD", () => {
      expect(createFormatters("en").formatCurrency(5)).toContain("$");
    });

    it("returns '' for NaN / Infinity", () => {
      const { formatCurrency } = createFormatters("en");
      expect(formatCurrency(Number.NaN)).toBe("");
      expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("");
    });
  });

  describe("formatPercent", () => {
    it("formatPercent(0.42) is '42%' in EN", () => {
      expect(createFormatters("en").formatPercent(0.42)).toBe("42%");
    });

    it("JA output contains 42", () => {
      expect(createFormatters("ja").formatPercent(0.42)).toContain("42");
    });

    it("returns '' for NaN / Infinity", () => {
      const { formatPercent } = createFormatters("en");
      expect(formatPercent(Number.NaN)).toBe("");
      expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("");
    });
  });

  describe("formatRelativeTime", () => {
    const now = new Date("2026-07-25T12:00:00Z");

    it("-2 days -> 'N days ago' in EN, non-empty distinct phrasing in JA", () => {
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const en = createFormatters("en").formatRelativeTime(twoDaysAgo, now);
      const ja = createFormatters("ja").formatRelativeTime(twoDaysAgo, now);

      expect(en.toLowerCase()).toContain("2");
      expect(en.toLowerCase()).toContain("ago");
      // JA CLDR has a dedicated word for -2 days ("一昨日", day-before-yesterday)
      // rather than a numeric phrase — assert non-empty and distinct from EN,
      // not that it contains a digit.
      expect(ja).not.toBe("");
      expect(ja).not.toBe(en);
    });

    it("-5 minutes -> '5 minutes ago' shape in both locales", () => {
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

      const en = createFormatters("en").formatRelativeTime(fiveMinAgo, now);
      const ja = createFormatters("ja").formatRelativeTime(fiveMinAgo, now);

      expect(en.toLowerCase()).toContain("5");
      expect(en.toLowerCase()).toContain("ago");
      expect(ja).toContain("5");
    });

    it("+3 hours -> future phrasing in both locales", () => {
      const threeHoursAhead = new Date(now.getTime() + 3 * 60 * 60 * 1000);

      const en = createFormatters("en").formatRelativeTime(threeHoursAhead, now);
      const ja = createFormatters("ja").formatRelativeTime(threeHoursAhead, now);

      expect(en.toLowerCase()).toContain("3");
      expect(en.toLowerCase()).toContain("in");
      expect(ja).toContain("3");
    });

    it("defaults `now` to the current time when omitted", () => {
      const nearNow = new Date(Date.now() - 1000);
      expect(createFormatters("en").formatRelativeTime(nearNow)).not.toBe("");
    });

    it("returns '' when target or now is invalid", () => {
      const { formatRelativeTime } = createFormatters("en");
      expect(formatRelativeTime(new Date("nope"), now)).toBe("");
      expect(formatRelativeTime("garbage", now)).toBe("");
      expect(formatRelativeTime(Number.NaN, now)).toBe("");
      expect(formatRelativeTime(now, new Date("nope"))).toBe("");
      expect(formatRelativeTime(now, Number.POSITIVE_INFINITY)).toBe("");
    });
  });

  describe("dateFnsLocaleFor", () => {
    it("maps 'en' to date-fns enUS and 'ja' to date-fns ja", () => {
      expect(dateFnsLocaleFor("en").code).toBe("en-US");
      expect(dateFnsLocaleFor("ja").code).toBe("ja");
    });

    it("is exposed on the formatter bundle too", () => {
      expect(createFormatters("en").dateFnsLocale.code).toBe("en-US");
      expect(createFormatters("ja").dateFnsLocale.code).toBe("ja");
    });
  });

  describe("Intl instance cache", () => {
    it("reuses the same Intl.DateTimeFormat instance for identical (locale, options)", () => {
      const { formatDate } = createFormatters("en");
      const options = { dateStyle: "long" } as const;

      formatDate(new Date("2026-01-01"), options);
      const first = __peekFormatCachesForTests.dateTimeFormat("en", options);

      formatDate(new Date("2026-02-02"), options);
      const second = __peekFormatCachesForTests.dateTimeFormat("en", options);

      expect(first).toBeDefined();
      expect(first).toBe(second);
      expect(__peekFormatCachesForTests.sizes().dateTimeFormat).toBe(1);
    });

    it("reuses the same Intl.NumberFormat instance for identical (locale, options)", () => {
      const { formatCurrency } = createFormatters("ja");

      formatCurrency(10, "JPY");
      const first = __peekFormatCachesForTests.numberFormat("ja", {
        style: "currency",
        currency: "JPY",
      });

      formatCurrency(20, "JPY");
      const second = __peekFormatCachesForTests.numberFormat("ja", {
        style: "currency",
        currency: "JPY",
      });

      expect(first).toBeDefined();
      expect(first).toBe(second);
      expect(__peekFormatCachesForTests.sizes().numberFormat).toBe(1);
    });

    it("reuses the same Intl.RelativeTimeFormat instance across calls", () => {
      const { formatRelativeTime } = createFormatters("en");
      const now = new Date("2026-07-25T12:00:00Z");

      formatRelativeTime(new Date(now.getTime() - 1000), now);
      const first = __peekFormatCachesForTests.relativeTimeFormat("en", { numeric: "auto" });

      formatRelativeTime(new Date(now.getTime() - 2000), now);
      const second = __peekFormatCachesForTests.relativeTimeFormat("en", { numeric: "auto" });

      expect(first).toBeDefined();
      expect(first).toBe(second);
      expect(__peekFormatCachesForTests.sizes().relativeTimeFormat).toBe(1);
    });

    it("builds a distinct instance when options differ", () => {
      const { formatDate } = createFormatters("en");

      formatDate(new Date("2026-01-01"), { dateStyle: "long" });
      formatDate(new Date("2026-01-01"), { dateStyle: "short" });

      expect(__peekFormatCachesForTests.sizes().dateTimeFormat).toBe(2);
    });
  });

  describe("createFormatters memoization", () => {
    it("returns the same formatter bundle instance for the same locale", () => {
      expect(createFormatters("en")).toBe(createFormatters("en"));
      expect(createFormatters("ja")).toBe(createFormatters("ja"));
    });
  });
});
