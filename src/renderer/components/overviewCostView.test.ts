/**
 * @file overviewCostView.test.ts
 * @description Unit tests for the pure overview cost hint helper.
 */
import { describe, expect, it } from "vitest";
import { createFormatters } from "~/shared/i18n/format";
import { createTranslator } from "~/shared/i18n/translate";
import {
  formatOverviewCostHint,
  resolveOverviewCostHint,
} from "./overviewCostView";
import type { CostSum } from "../analytics/shared";

const cost = (overrides: Partial<CostSum>): CostSum => ({
  totalUsd: 0,
  pricedCount: 0,
  total: 0,
  hasNa: false,
  ...overrides,
});

describe("resolveOverviewCostHint", () => {
  it("returns none when there are no entries", () => {
    expect(resolveOverviewCostHint(cost({}))).toEqual({ kind: "none" });
  });

  it("returns na when every entry is unpriced", () => {
    expect(
      resolveOverviewCostHint(cost({ total: 3, pricedCount: 0, hasNa: true }))
    ).toEqual({ kind: "na" });
  });

  it("returns standard precision for a fully priced sum", () => {
    expect(
      resolveOverviewCostHint(
        cost({ totalUsd: 1.23, pricedCount: 2, total: 2, hasNa: false })
      )
    ).toEqual({
      kind: "amount",
      valueUsd: 1.23,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it("returns widened precision for a tiny sub-cent sum", () => {
    expect(
      resolveOverviewCostHint(
        cost({ totalUsd: 0.0006, pricedCount: 1, total: 1, hasNa: false })
      )
    ).toEqual({
      kind: "amount",
      valueUsd: 0.0006,
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  });

  it("carries partial coverage when hasNa is true", () => {
    expect(
      resolveOverviewCostHint(
        cost({ totalUsd: 0.5, pricedCount: 2, total: 4, hasNa: true })
      )
    ).toEqual({
      kind: "amount",
      valueUsd: 0.5,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      partial: { priced: 2, total: 4 },
    });
  });
});

describe("formatOverviewCostHint", () => {
  const localeCases = ["en" as const, "ja" as const];

  it("returns undefined for an empty range", () => {
    const t = createTranslator("en");
    const { formatNumber } = createFormatters("en");
    expect(formatOverviewCostHint(cost({}), t, formatNumber)).toBeUndefined();
  });

  it.each(localeCases)(
    "renders the translated N/A hint when nothing is priced in %s",
    (locale) => {
      const t = createTranslator(locale);
      const { formatNumber } = createFormatters(locale);
      expect(
        formatOverviewCostHint(
          cost({ total: 2, pricedCount: 0, hasNa: true }),
          t,
          formatNumber
        )
      ).toBe(t("overview.value.estimatedCostNa"));
    }
  );

  it.each(localeCases)(
    "renders a full-coverage hint in %s",
    (locale) => {
      const t = createTranslator(locale);
      const { formatNumber } = createFormatters(locale);
      const hint = formatOverviewCostHint(
        cost({ totalUsd: 1.23, pricedCount: 2, total: 2, hasNa: false }),
        t,
        formatNumber
      );
      expect(hint).toContain("$1.23");
      expect(hint).toBe(t("overview.value.estimatedCost", { cost: "$1.23" }));
    }
  );

  it.each(localeCases)(
    "renders a partial-coverage hint in %s",
    (locale) => {
      const t = createTranslator(locale);
      const { formatNumber } = createFormatters(locale);
      const hint = formatOverviewCostHint(
        cost({ totalUsd: 0.5, pricedCount: 2, total: 4, hasNa: true }),
        t,
        formatNumber
      );
      expect(hint).toBe(
        t("overview.value.estimatedCostPartial", {
          cost: "$0.50",
          priced: 2,
          total: 4,
        })
      );
    }
  );
});
