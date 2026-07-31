import { beforeEach, describe, expect, it, vi } from "vitest";
import { autocompleteUsageStore, localDayKey } from "./autocompleteUsageStore";

// Stateful in-memory backing store so get/set round-trip within a test,
// mirroring src/features/i18n/store/localeStore.test.ts.
const { storeData } = vi.hoisted(() => ({ storeData: {} as Record<string, unknown> }));

vi.mock("electron-store", () => {
  class MockStore {
    get(key: string, defaultValue?: unknown) {
      return key in storeData ? storeData[key] : defaultValue;
    }
    set(key: string, value: unknown) {
      storeData[key] = value;
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});

const usage = (promptTokens: number | null, completionTokens: number | null, cost: number | null) => ({
  promptTokens,
  completionTokens,
  estimatedCostUsd: cost,
});

/**
 * One whole request as the service performs it: dispatched first, then its
 * usage folded in once the response returns. Every pre-split test recorded
 * both halves at once, so they keep asserting the same totals.
 */
const record = (
  delta: ReturnType<typeof usage>,
  now: Date,
): void => {
  autocompleteUsageStore.recordDispatch(now);
  autocompleteUsageStore.recordUsage(delta, now);
};

describe("localDayKey", () => {
  // toISOString would roll the day over at UTC midnight rather than the user's,
  // so "today" would be wrong for most of the evening in eastern time zones.
  it("formats local time, not UTC", () => {
    expect(localDayKey(new Date(2026, 6, 31, 23, 30))).toBe("2026-07-31");
  });

  it("zero-pads month and day", () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("autocompleteUsageStore", () => {
  const today = new Date(2026, 6, 31, 12, 0);

  beforeEach(() => {
    for (const key of Object.keys(storeData)) {
      Reflect.deleteProperty(storeData, key);
    }
  });

  it("starts from an empty rollup", () => {
    expect(autocompleteUsageStore.getDay(today)).toEqual({
      date: "2026-07-31",
      requests: 0,
      responses: 0,
      tokenlessResponses: 0,
      unpricedResponses: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    });
  });

  it("accumulates requests, tokens and cost across calls", () => {
    record(usage(100, 20, 0.001), today);
    record(usage(150, 25, 0.002), today);

    expect(autocompleteUsageStore.getDay(today)).toEqual({
      date: "2026-07-31",
      requests: 2,
      responses: 2,
      tokenlessResponses: 0,
      unpricedResponses: 0,
      promptTokens: 250,
      completionTokens: 45,
      estimatedCostUsd: 0.003,
    });
  });

  // Local providers report no token counts. The request still happened, so a
  // day reading zero requests would misreport what actually ran.
  it("counts a request whose token and cost figures are unavailable", () => {
    record(usage(null, null, null), today);

    const day = autocompleteUsageStore.getDay(today);
    expect(day.requests).toBe(1);
    expect(day.promptTokens).toBe(0);
    expect(day.estimatedCostUsd).toBe(0);
  });

  /**
   * The never-a-false-zero rule, which `cost.ts` and `overviewCostView.ts` both
   * treat as load-bearing. Coalescing a null cost to `0` and summing it made a
   * day of genuinely billed direct-OpenAI requests report `$0.00`, and nothing
   * downstream could tell that apart from a day that really cost nothing.
   */
  describe("cost coverage", () => {
    it("does not let an unpriceable response read as a real zero", () => {
      record(usage(100, 20, null), today);

      const day = autocompleteUsageStore.getDay(today);
      expect(day.responses).toBe(1);
      expect(day.unpricedResponses).toBe(1);
      // The number is honest only because `unpricedResponses` says it covers
      // nothing. Read on its own it is exactly the lie this pair prevents.
      expect(day.estimatedCostUsd).toBe(0);
    });

    it("sums only the priced responses into the amount", () => {
      record(usage(100, 20, 0.004), today);
      record(usage(100, 20, null), today);

      const day = autocompleteUsageStore.getDay(today);
      expect(day.responses).toBe(2);
      expect(day.unpricedResponses).toBe(1);
      expect(day.estimatedCostUsd).toBeCloseTo(0.004);
    });

    it("reports a fully priced day as covering every response", () => {
      record(usage(100, 20, 0.001), today);
      record(usage(100, 20, 0.002), today);

      const day = autocompleteUsageStore.getDay(today);
      expect(day.unpricedResponses).toBe(0);
      expect(day.responses).toBe(2);
    });

    /**
     * Part-known and part-unknown is its own state, and it has to survive being
     * summed. A month whose priced and unpriced days collapsed into "priced"
     * would report its knowable half as the whole bill.
     */
    it("keeps a part-priced month part-priced", () => {
      record(usage(100, 20, 0.01), new Date(2026, 6, 2, 9, 0));
      record(usage(100, 20, null), new Date(2026, 6, 20, 9, 0));
      record(usage(100, 20, 0.02), new Date(2026, 6, 20, 10, 0));

      const month = autocompleteUsageStore.getMonth(today);
      expect(month.responses).toBe(3);
      expect(month.unpricedResponses).toBe(1);
      expect(month.estimatedCostUsd).toBeCloseTo(0.03);
    });
  });

  /**
   * Tokens and price go missing for DIFFERENT reasons and must not share a
   * flag: a local provider reports no tokens but a genuinely known $0, while
   * direct OpenAI reports real tokens that `computeCost` refuses to price.
   */
  describe("token coverage", () => {
    it("counts a response that reported no token counts", () => {
      record(usage(null, null, 0), today);

      const day = autocompleteUsageStore.getDay(today);
      expect(day.responses).toBe(1);
      expect(day.tokenlessResponses).toBe(1);
      expect(day.unpricedResponses).toBe(0);
    });

    it("counts a partially reported response as tokenless too", () => {
      record(usage(100, null, 0.001), today);

      expect(autocompleteUsageStore.getDay(today).tokenlessResponses).toBe(1);
    });

    it("tracks missing tokens and missing prices independently", () => {
      // A local provider: no tokens, but $0 is the truth, not a guess.
      record(usage(null, null, 0), today);
      // Direct OpenAI: real tokens, no price anywhere.
      record(usage(80, 12, null), today);

      const day = autocompleteUsageStore.getDay(today);
      expect(day.responses).toBe(2);
      expect(day.tokenlessResponses).toBe(1);
      expect(day.unpricedResponses).toBe(1);
      expect(day.promptTokens).toBe(80);
    });
  });

  /**
   * A day written before these counters existed has no `responses` field, and
   * `undefined + 1` is `NaN` — a rollup that poisons every total it reaches
   * with no error anywhere.
   */
  describe("a day persisted without the coverage counters", () => {
    /**
     * The money and the tokens are deliberately NON-ZERO. A fixture with
     * `estimatedCostUsd: 0` cannot tell a dropped legacy amount from a kept one,
     * and that zero is exactly what hid a legacy day's $0.50 leaking into a
     * month total.
     */
    const legacyDay = (requests: number) => ({
      date: "2026-07-31",
      requests,
      promptTokens: 10,
      completionTokens: 2,
      estimatedCostUsd: 0.5,
    });

    it("normalizes it rather than summing undefined into NaN", () => {
      storeData.days = { "2026-07-31": legacyDay(4) };

      autocompleteUsageStore.recordUsage(usage(10, 2, 0.5), today);

      const day = autocompleteUsageStore.getDay(today);
      expect(day.requests).toBe(4);
      expect(Number.isNaN(day.responses)).toBe(false);
      // Only the new response's own figures — the legacy sums were dropped.
      expect(day.promptTokens).toBe(10);
      expect(day.estimatedCostUsd).toBeCloseTo(0.5);
    });

    /**
     * Back-filling the counters with `0` is not neutral — `unpricedResponses: 0`
     * is the read rules' "every price is known", so a legacy day of billed
     * requests claimed FULL coverage. Its coverage was never recorded, so it is
     * booked as entirely unknown instead: `unpricedResponses === responses`,
     * which the read rules render as N/A and never as a number.
     */
    it("books it as unknown coverage, not as fully priced", () => {
      storeData.days = { "2026-07-31": legacyDay(4) };

      const day = autocompleteUsageStore.getDay(today);
      expect(day.responses).toBe(4);
      expect(day.unpricedResponses).toBe(4);
      expect(day.tokenlessResponses).toBe(4);
    });

    /**
     * The counters and the sums have to tell ONE story. `estimatedCostUsd` sums
     * PRICED responses only and the token fields sum the responses that REPORTED
     * them, so a day booking every response as unpriced and tokenless cannot
     * also carry money and tokens — the two halves of one day would contradict
     * each other, and the contradiction is what escapes through `getMonth()`.
     */
    it("makes no money or token claim it has labelled unknown", () => {
      storeData.days = { "2026-07-31": legacyDay(4) };

      const day = autocompleteUsageStore.getDay(today);
      expect(day.estimatedCostUsd).toBe(0);
      expect(day.promptTokens).toBe(0);
      expect(day.completionTokens).toBe(0);
    });

    /**
     * The seam the single-day rule cannot protect. A day on its own is saved by
     * `unpricedResponses === responses`, which refuses to render a number at
     * all — but SUMMING destroys that equality. One new priced response makes
     * the month `200 < 201`, which the read rules treat as "amount plus
     * coverage", and the real view code rendered
     * `Est. $0.504 (1 of 201 priced)`: $0.50 of legacy money on screen behind a
     * badge claiming a single response was behind it, understating the amount's
     * backing by two orders of magnitude.
     */
    it("keeps a month that mixes it with a new priced response part-priced", () => {
      storeData.days = {
        "2026-07-02": { date: "2026-07-02", requests: 200, promptTokens: 1000, completionTokens: 200, estimatedCostUsd: 0.5 },
      };

      record(usage(100, 20, 0.004), new Date(2026, 6, 20, 9, 0));

      const month = autocompleteUsageStore.getMonth(today);
      expect(month.responses).toBe(201);
      expect(month.unpricedResponses).toBe(200);
      expect(month.unpricedResponses).toBeLessThan(month.responses);
      // The priced response's cost and NOTHING else: not 0.504.
      expect(month.estimatedCostUsd).toBeCloseTo(0.004);
      // Same rule on the token axis, which `tokenlessResponses` reads the same
      // way — 1100 here would be the identical lie in tokens.
      expect(month.promptTokens).toBe(100);
      expect(month.completionTokens).toBe(20);
    });

    /**
     * The migration must not keep migrating. A day read back after it has been
     * written carries `responses`, so it takes the non-legacy path — and has to
     * land on the same values, or the numbers a user sees drift with every
     * write.
     */
    it("re-reads a migrated day unchanged", () => {
      storeData.days = { "2026-07-31": legacyDay(4) };
      const migrated = autocompleteUsageStore.getDay(today);

      storeData.days = { "2026-07-31": migrated };

      expect(autocompleteUsageStore.getDay(today)).toEqual(migrated);
    });

    // A genuinely new empty day is NOT a legacy day: it has no `requests`
    // either, so there is nothing to declare unknown and `0` is the truth.
    it("leaves a genuinely empty day claiming nothing", () => {
      storeData.days = { "2026-07-31": { date: "2026-07-31" } };

      const day = autocompleteUsageStore.getDay(today);
      expect(day.requests).toBe(0);
      expect(day.responses).toBe(0);
      expect(day.unpricedResponses).toBe(0);
    });
  });

  /**
   * The split exists so the cap can count attempts. A request is dispatched
   * and billed the moment it leaves; whether it returns usage is a separate
   * question, and one that a superseded request answers with silence.
   */
  describe("dispatch and usage are recorded separately", () => {
    it("counts a dispatch on its own, with no tokens", () => {
      autocompleteUsageStore.recordDispatch(today);

      expect(autocompleteUsageStore.getDay(today)).toEqual({
        date: "2026-07-31",
        requests: 1,
        responses: 0,
        tokenlessResponses: 0,
        unpricedResponses: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
      });
    });

    it("folds usage into the day without counting a second request", () => {
      autocompleteUsageStore.recordDispatch(today);
      autocompleteUsageStore.recordUsage(usage(100, 20, 0.001), today);

      expect(autocompleteUsageStore.getDay(today)).toEqual({
        date: "2026-07-31",
        requests: 1,
        responses: 1,
        tokenlessResponses: 0,
        unpricedResponses: 0,
        promptTokens: 100,
        completionTokens: 20,
        estimatedCostUsd: 0.001,
      });
    });

    it("still counts a dispatch whose response never arrived", () => {
      autocompleteUsageStore.recordDispatch(today);
      autocompleteUsageStore.recordDispatch(today);
      autocompleteUsageStore.recordUsage(usage(100, 20, 0.001), today);

      const day = autocompleteUsageStore.getDay(today);
      expect(day.requests).toBe(2);
      expect(day.promptTokens).toBe(100);
    });
  });

  it("keeps days separate", () => {
    const yesterday = new Date(2026, 6, 30, 12, 0);
    record(usage(10, 1, 0.1), yesterday);
    record(usage(20, 2, 0.2), today);

    expect(autocompleteUsageStore.getDay(yesterday).requests).toBe(1);
    expect(autocompleteUsageStore.getDay(today).promptTokens).toBe(20);
  });

  describe("getMonth", () => {
    it("sums only the days inside the calendar month", () => {
      record(usage(10, 1, 0.1), new Date(2026, 6, 1, 9, 0));
      record(usage(20, 2, 0.2), new Date(2026, 6, 31, 9, 0));
      record(usage(999, 99, 9.9), new Date(2026, 5, 30, 9, 0));

      const month = autocompleteUsageStore.getMonth(today);
      expect(month.requests).toBe(2);
      expect(month.promptTokens).toBe(30);
      expect(month.estimatedCostUsd).toBeCloseTo(0.3);
    });

    it("is empty when nothing was recorded this month", () => {
      record(usage(10, 1, 0.1), new Date(2026, 5, 30, 9, 0));

      expect(autocompleteUsageStore.getMonth(today).requests).toBe(0);
    });
  });

  // The file must not grow without bound as the feature runs every day.
  it("retains a bounded number of days, keeping the most recent", () => {
    for (let dayOffset = 0; dayOffset < 70; dayOffset += 1) {
      record(usage(1, 1, 0), new Date(2026, 6, 31 - dayOffset, 9, 0));
    }

    const days = storeData.days as Record<string, unknown>;
    expect(Object.keys(days)).toHaveLength(62);
    expect(days["2026-07-31"]).toBeDefined();
  });

  describe("getDays", () => {
    it("is empty when nothing was recorded", () => {
      expect(autocompleteUsageStore.getDays()).toEqual([]);
    });

    it("returns every retained day, newest first", () => {
      record(usage(10, 1, 0.1), new Date(2026, 6, 29, 9, 0));
      record(usage(20, 2, 0.2), new Date(2026, 6, 31, 9, 0));
      record(usage(30, 3, 0.3), new Date(2026, 6, 30, 9, 0));

      expect(autocompleteUsageStore.getDays().map((day) => day.date)).toEqual([
        "2026-07-31",
        "2026-07-30",
        "2026-07-29",
      ]);
    });

    /**
     * Seeded straight into the backing store, out of order, so the assertion
     * depends on `getDays()` sorting rather than on the write path happening
     * to have sorted first. Recording through `recordDispatch` pre-sorts, which
     * is why deleting the reader's sort used to change nothing.
     */
    it("sorts the days it reads, not merely the days it wrote", () => {
      storeData.days = {
        "2026-07-29": { date: "2026-07-29", requests: 1, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
        "2026-07-31": { date: "2026-07-31", requests: 1, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
        "2026-07-30": { date: "2026-07-30", requests: 1, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
      };

      expect(autocompleteUsageStore.getDays().map((day) => day.date)).toEqual([
        "2026-07-31",
        "2026-07-30",
        "2026-07-29",
      ]);
    });

    // Same bound as the retained-days test above, from the reader's side.
    it("never returns more than the retained bound", () => {
      for (let dayOffset = 0; dayOffset < 70; dayOffset += 1) {
        record(usage(1, 1, 0), new Date(2026, 6, 31 - dayOffset, 9, 0));
      }

      expect(autocompleteUsageStore.getDays()).toHaveLength(62);
    });
  });
});
