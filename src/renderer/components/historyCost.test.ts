/**
 * @file historyCost.test.ts
 * @description Unit tests for the pure resolveCostDisplay helper (#56), plus
 * behavioral coverage of formatCostLabel's rendering in both shipped locales.
 */
import { describe, expect, it } from "vitest";
import { createFormatters } from "~/features/i18n/shared/format";
import { createTranslator } from "~/features/i18n/shared/translate";
import { formatCostLabel, resolveCostDisplay } from "./historyCost";

describe("resolveCostDisplay", () => {
  it("resolves 'na' for status 'na'", () => {
    expect(resolveCostDisplay({ costStatus: "na", estimatedCostUsd: null })).toEqual(
      { kind: "na" }
    );
  });

  it("resolves 'na' for a legacy/migrated entry with no cost fields", () => {
    expect(resolveCostDisplay({})).toEqual({ kind: "na" });
  });

  it("resolves a standard-precision zero for a genuine zero (local/Ollama)", () => {
    expect(resolveCostDisplay({ costStatus: "zero", estimatedCostUsd: 0 })).toEqual({
      kind: "amount",
      valueUsd: 0,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it("resolves standard precision for a priced 'ok' cost", () => {
    expect(
      resolveCostDisplay({ costStatus: "ok", estimatedCostUsd: 1.23 })
    ).toEqual({
      kind: "amount",
      valueUsd: 1.23,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it("resolves widened precision for a tiny sub-cent 'ok' cost", () => {
    expect(
      resolveCostDisplay({ costStatus: "ok", estimatedCostUsd: 0.0006 })
    ).toEqual({
      kind: "amount",
      valueUsd: 0.0006,
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  });

  it("resolves 'na' for an 'ok' status with a null cost (inconsistent state)", () => {
    expect(resolveCostDisplay({ costStatus: "ok", estimatedCostUsd: null })).toEqual(
      { kind: "na" }
    );
  });

  it("resolves standard precision when an 'ok' cost is exactly zero", () => {
    expect(
      resolveCostDisplay({ costStatus: "ok", estimatedCostUsd: 0 })
    ).toEqual({
      kind: "amount",
      valueUsd: 0,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });
});

describe("formatCostLabel", () => {
  const localeCases = ["en" as const, "ja" as const];

  it.each(localeCases)(
    "renders the translated N/A key in %s",
    (locale) => {
      const t = createTranslator(locale);
      const { formatNumber } = createFormatters(locale);
      expect(
        formatCostLabel({ costStatus: "na", estimatedCostUsd: null }, t, formatNumber)
      ).toBe(t("history.cost.na"));
    }
  );

  it("renders different N/A wording per locale — not a coincidental match", () => {
    expect(createTranslator("en")("history.cost.na")).not.toBe(
      createTranslator("ja")("history.cost.na"),
    );
  });

  it.each(localeCases)(
    "renders $0.00 for a genuine zero in %s",
    (locale) => {
      const t = createTranslator(locale);
      const { formatNumber } = createFormatters(locale);
      expect(
        formatCostLabel({ costStatus: "zero", estimatedCostUsd: 0 }, t, formatNumber)
      ).toBe("$0.00");
    }
  );

  it.each(localeCases)(
    "renders a two-decimal USD amount for a priced cost in %s",
    (locale) => {
      const t = createTranslator(locale);
      const { formatNumber } = createFormatters(locale);
      expect(
        formatCostLabel({ costStatus: "ok", estimatedCostUsd: 1.23 }, t, formatNumber)
      ).toBe("$1.23");
    }
  );

  it.each(localeCases)(
    "does not collapse a tiny sub-cent cost to $0.00 in %s",
    (locale) => {
      const t = createTranslator(locale);
      const { formatNumber } = createFormatters(locale);
      const label = formatCostLabel(
        { costStatus: "ok", estimatedCostUsd: 0.0006 },
        t,
        formatNumber
      );
      expect(label).not.toBe("$0.00");
      expect(label).toBe("$0.0006");
    }
  );
});
