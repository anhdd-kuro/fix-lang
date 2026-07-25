/**
 * @file presetChartView.test.ts
 * @description Unit tests for the pure preset-donut view helpers (Chunk 8).
 * Descriptor shape is asserted directly; rendered strings are asserted
 * through `createTranslator` (EN + JA).
 */
import { describe, expect, it } from "vitest";
import { resolveMessage } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import { CHART_TITLE_KEYS, donutTooltipMessage, weightPercent } from "./presetChartView";

describe("CHART_TITLE_KEYS", () => {
  it("maps the donut + combo chart titles to their keys", () => {
    expect(CHART_TITLE_KEYS).toEqual({
      presetShare: "charts.presetShare.title",
      correctionsOverTime: "charts.correctionsOverTime.title",
    });
  });
});

describe("weightPercent", () => {
  it("rounds to one decimal percent", () => {
    expect(weightPercent(0.5)).toBe(50);
    expect(weightPercent(1 / 3)).toBe(33.3);
    expect(weightPercent(0)).toBe(0);
    expect(weightPercent(1)).toBe(100);
  });
});

describe("donutTooltipMessage", () => {
  it("singular count → the withCorrections-style base key with a string pct + numeric count", () => {
    expect(donutTooltipMessage({ count: 1 }, "50.0")).toEqual({
      key: "charts.presetShare.tooltip",
      params: { pct: "50.0", count: 1 },
    });
  });

  it("plural count → same base key, count still a raw number for plural selection", () => {
    expect(donutTooltipMessage({ count: 12 }, "8.3")).toEqual({
      key: "charts.presetShare.tooltip",
      params: { pct: "8.3", count: 12 },
    });
  });
});

describe("rendered donut tooltip strings (EN + JA)", () => {
  it("count 1 (singular)", () => {
    const message = donutTooltipMessage({ count: 1 }, "50.0");
    expect(resolveMessage(message, createTranslator("en"))).toBe("50.0% · 1 transform");
    // ja has no `_one` member; Intl.PluralRules("ja") always resolves "other".
    expect(resolveMessage(message, createTranslator("ja"))).toBe("50.0% · 1 件の変換");
  });

  it("count 12 (plural)", () => {
    const message = donutTooltipMessage({ count: 12 }, "50.0");
    expect(resolveMessage(message, createTranslator("en"))).toBe("50.0% · 12 transforms");
    expect(resolveMessage(message, createTranslator("ja"))).toBe("50.0% · 12 件の変換");
  });
});
