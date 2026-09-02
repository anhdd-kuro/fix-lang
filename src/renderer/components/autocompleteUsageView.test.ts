/**
 * @file autocompleteUsageView.test.ts
 * @description Unit tests for the pure Autocomplete dashboard view helpers.
 * Expected values below are hand-computed literals, never re-derived with the
 * function under test — a test that recomputes its expectation the way the
 * code does would pass by construction and could never catch a wrong
 * implementation.
 *
 * Covers the four reading rules `AutocompleteDayRollup`'s own doc comment
 * states (see `autocompleteWire.ts`), including the mixed-coverage case that
 * the old `requests > 0 && everything-zero` heuristic got wrong: a rollup can
 * have SOME priced responses and SOME unpriced ones in the same day, and that
 * must render as "the known part, plus how much is known" — never collapsed
 * into just the known total.
 */
import { describe, expect, it } from "vitest";
import { createFormatters } from "~/features/i18n/shared/format";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  formatAutocompleteCost,
  formatAutocompleteCount,
  formatAutocompleteCoverage,
  isAutocompleteUsageEmpty,
  resolveAutocompleteCapUsage,
  resolveAutocompleteRollupView,
  resolveAutocompleteUsageView,
} from "./autocompleteUsageView";
import type { AutocompleteDayRollup, AutocompleteUsageSnapshot } from "~/features/autocomplete/shared/autocompleteWire";

const rollup = (overrides: Partial<AutocompleteDayRollup> = {}): AutocompleteDayRollup => ({
  date: "2026-07-31",
  requests: 0,
  responses: 0,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
  ...overrides,
});

describe("resolveAutocompleteRollupView — reading rule 1: nothing happened", () => {
  it("reports a real zero (never N/A) when requests is 0", () => {
    const view = resolveAutocompleteRollupView(rollup({ requests: 0, responses: 0 }));
    expect(view.totalTokens).toEqual({ kind: "value", value: 0 });
    expect(view.estimatedCostUsd).toEqual({ kind: "value", value: 0 });
  });

  it("reports a real zero when requests were dispatched but none came back (responses is 0)", () => {
    // Every request aborted mid-keystroke — attempts were made (requests > 0)
    // but nothing came back to be priced or counted.
    const view = resolveAutocompleteRollupView(rollup({ requests: 5, responses: 0 }));
    expect(view.requests).toBe(5);
    expect(view.responses).toBe(0);
    expect(view.totalTokens).toEqual({ kind: "value", value: 0 });
    expect(view.estimatedCostUsd).toEqual({ kind: "value", value: 0 });
  });
});

describe("resolveAutocompleteRollupView — reading rule 2: fully known", () => {
  it("reports the real total with no partial flag when every response reported it", () => {
    const view = resolveAutocompleteRollupView(
      rollup({
        requests: 10,
        responses: 10,
        tokenlessResponses: 0,
        unpricedResponses: 0,
        promptTokens: 120,
        completionTokens: 30,
        estimatedCostUsd: 0.02,
      })
    );
    expect(view.totalTokens).toEqual({ kind: "value", value: 150 });
    expect(view.estimatedCostUsd).toEqual({ kind: "value", value: 0.02 });
  });
});

describe("resolveAutocompleteRollupView — reading rule 3: nothing known", () => {
  it("reports cost as N/A, never the fabricated $0 the old heuristic produced, when every response is unpriced (direct-OpenAI-style)", () => {
    // Direct OpenAI: real token counts, but every response carries no
    // knowable price — this is exactly the case the deleted
    // `requests > 0 && everything-zero` heuristic misread as "measured".
    const view = resolveAutocompleteRollupView(
      rollup({
        requests: 4,
        responses: 4,
        tokenlessResponses: 0,
        unpricedResponses: 4,
        promptTokens: 800,
        completionTokens: 200,
        estimatedCostUsd: 0,
      })
    );
    expect(view.estimatedCostUsd).toEqual({ kind: "na" });
    // Tokens are a SEPARATE axis — fully known here, so they must NOT also
    // collapse to N/A just because cost is unknown.
    expect(view.totalTokens).toEqual({ kind: "value", value: 1000 });
  });

  it("reports tokens as N/A when every response under-reported them (local-provider-style), while cost stays a real $0", () => {
    const view = resolveAutocompleteRollupView(
      rollup({
        requests: 7,
        responses: 7,
        tokenlessResponses: 7,
        unpricedResponses: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
      })
    );
    expect(view.totalTokens).toEqual({ kind: "na" });
    // Cost is honestly known to be $0 for a local provider — a SEPARATE axis
    // from "tokens weren't reported".
    expect(view.estimatedCostUsd).toEqual({ kind: "value", value: 0 });
  });
});

describe("resolveAutocompleteRollupView — reading rule 4: mixed coverage", () => {
  it("reports the known amount PLUS its coverage, never collapsing to the knowable half", () => {
    const view = resolveAutocompleteRollupView(
      rollup({
        requests: 3,
        responses: 3,
        tokenlessResponses: 1,
        unpricedResponses: 1,
        promptTokens: 200,
        completionTokens: 40,
        estimatedCostUsd: 0.03,
      })
    );
    expect(view.estimatedCostUsd).toEqual({
      kind: "value",
      value: 0.03,
      partial: { known: 2, total: 3 },
    });
    expect(view.totalTokens).toEqual({
      kind: "value",
      value: 240,
      partial: { known: 2, total: 3 },
    });
  });
});

describe("resolveAutocompleteCapUsage", () => {
  it("computes the used ratio against the daily spend cap", () => {
    expect(
      resolveAutocompleteCapUsage(
        rollup({ requests: 750, responses: 750, estimatedCostUsd: 2.5 }),
        5,
      ),
    ).toEqual({ spent: { kind: "value", value: 2.5, partial: undefined }, capUsd: 5, ratio: 0.5 });
  });

  it("clamps a ratio above 1 down to 1", () => {
    expect(
      resolveAutocompleteCapUsage(
        rollup({ responses: 10, estimatedCostUsd: 9 }),
        5,
      ).ratio,
    ).toBe(1);
  });

  /**
   * The `$0.00 of $5.00` bug, pinned. A day whose responses ALL went unpriced
   * has `estimatedCostUsd: 0` sitting in the rollup over real billed activity,
   * and drawing a ratio from it paints an empty bar and a confident zero.
   */
  it("reports unmeasured spend as N/A with no bar, never as $0", () => {
    const usage = resolveAutocompleteCapUsage(
      rollup({ requests: 42, responses: 42, unpricedResponses: 42, estimatedCostUsd: 0 }),
      5,
    );

    expect(usage.spent).toEqual({ kind: "na" });
    expect(usage.ratio).toBe(0);
  });

  it("returns a 0 ratio (not NaN/Infinity) when the cap is 0", () => {
    expect(
      resolveAutocompleteCapUsage(rollup({ responses: 5, estimatedCostUsd: 1 }), 0).ratio,
    ).toBe(0);
  });

  /**
   * The bar is drawn from PRICED spend only. Left unqualified it reads as
   * "plenty of budget left" over money nobody can measure — the same false zero
   * the rollup's coverage counters exist to stop, redrawn as a progress bar.
   */
  it("reports partial coverage when some responses carried no price", () => {
    expect(
      resolveAutocompleteCapUsage(
        rollup({ responses: 10, unpricedResponses: 4, estimatedCostUsd: 1 }),
        5,
      ),
    ).toEqual({
      spent: { kind: "value", value: 1, partial: { known: 6, total: 10 } },
      capUsd: 5,
      ratio: 0.2,
    });
  });

  it("carries no coverage qualifier when every response was priced", () => {
    expect(
      resolveAutocompleteCapUsage(
        rollup({ responses: 10, unpricedResponses: 0, estimatedCostUsd: 1 }),
        5,
      ).spent,
    ).toEqual({ kind: "value", value: 1, partial: undefined });
  });
});

describe("resolveAutocompleteUsageView", () => {
  it("assembles today, month, the day series, and cap usage from a snapshot", () => {
    const snapshot: AutocompleteUsageSnapshot = {
      today: rollup({
        date: "2026-07-31",
        requests: 300,
        responses: 300,
        promptTokens: 4000,
        completionTokens: 900,
        estimatedCostUsd: 0.15,
      }),
      month: rollup({
        date: "2026-07",
        requests: 5000,
        responses: 5000,
        promptTokens: 60000,
        completionTokens: 15000,
        estimatedCostUsd: 2.4,
      }),
      days: [
        rollup({
          date: "2026-07-31",
          requests: 300,
          responses: 300,
          promptTokens: 4000,
          completionTokens: 900,
          estimatedCostUsd: 0.15,
        }),
        rollup({ date: "2026-07-30", requests: 50, responses: 0 }),
      ],
      dailyCostCapUsd: 5,
    };

    const view = resolveAutocompleteUsageView(snapshot);

    expect(view.today.requests).toBe(300);
    expect(view.today.totalTokens).toEqual({ kind: "value", value: 4900 });
    expect(view.month.requests).toBe(5000);
    expect(view.month.estimatedCostUsd).toEqual({ kind: "value", value: 2.4 });
    expect(view.days).toHaveLength(2);
    expect(view.days[0].date).toBe("2026-07-31");
    // 50 requests, 0 responses — attempted but nothing came back: a real zero.
    expect(view.days[1].totalTokens).toEqual({ kind: "value", value: 0 });
    expect(view.cap).toEqual({
      spent: { kind: "value", value: 0.15, partial: undefined },
      capUsd: 5,
      ratio: 0.03,
    });
  });
});

describe("isAutocompleteUsageEmpty", () => {
  it("is true when today, month, and the day series are all empty", () => {
    const view = resolveAutocompleteUsageView({
      today: rollup(),
      month: rollup(),
      days: [],
      dailyCostCapUsd: 1500,
    });
    expect(isAutocompleteUsageEmpty(view)).toBe(true);
  });

  it("is false when today has requests even with no day series", () => {
    const view = resolveAutocompleteUsageView({
      today: rollup({ requests: 1, responses: 1 }),
      month: rollup({ requests: 1, responses: 1 }),
      days: [],
      dailyCostCapUsd: 1500,
    });
    expect(isAutocompleteUsageEmpty(view)).toBe(false);
  });
});

describe("formatAutocompleteCount / formatAutocompleteCost / formatAutocompleteCoverage", () => {
  const localeCases = ["en" as const, "ja" as const];

  // Hand-computed literals — copied from the catalog JSON by eye, never read
  // back through `t()`, so a wrong catalog value or a wrong `kind === "na"`
  // branch in the implementation cannot pass by construction.
  const naLiteral: Record<"en" | "ja", string> = { en: "N/A", ja: "未計測" };

  it.each(localeCases)("renders the translated N/A for an unmeasured count in %s", (locale) => {
    const t = createTranslator(locale);
    const { formatNumber } = createFormatters(locale);
    expect(formatAutocompleteCount({ kind: "na" }, t, formatNumber)).toBe(naLiteral[locale]);
  });

  it.each(localeCases)("renders the translated N/A for an unmeasured cost in %s", (locale) => {
    const t = createTranslator(locale);
    const { formatCurrency } = createFormatters(locale);
    expect(formatAutocompleteCost({ kind: "na" }, t, formatCurrency)).toBe(naLiteral[locale]);
  });

  it("renders a locale-formatted number for a measured count", () => {
    const t = createTranslator("en");
    const { formatNumber } = createFormatters("en");
    expect(formatAutocompleteCount({ kind: "value", value: 1234 }, t, formatNumber)).toBe("1,234");
  });

  it("renders a locale-formatted currency amount for a measured cost", () => {
    const t = createTranslator("en");
    const { formatCurrency } = createFormatters("en");
    expect(formatAutocompleteCost({ kind: "value", value: 1.5 }, t, formatCurrency)).toBe("$1.50");
  });

  it("renders no coverage hint for a fully-known metric", () => {
    const t = createTranslator("en");
    expect(formatAutocompleteCoverage({ kind: "value", value: 42 }, t)).toBeUndefined();
  });

  it("renders no coverage hint for an N/A metric", () => {
    const t = createTranslator("en");
    expect(formatAutocompleteCoverage({ kind: "na" }, t)).toBeUndefined();
  });

  it("renders the known/total coverage hint for a partially-known metric", () => {
    const t = createTranslator("en");
    expect(
      formatAutocompleteCoverage({ kind: "value", value: 240, partial: { known: 2, total: 3 } }, t)
    ).toBe("2 of 3 known"); // hand-computed from en/dashboard.json, not re-derived via t()
  });
});
