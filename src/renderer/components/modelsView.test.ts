/**
 * @file modelsView.test.ts
 * @description Unit tests for the pure Models tab view helpers (Chunk 8).
 * Descriptor shape is asserted directly; rendered strings are asserted
 * through `createTranslator` (EN + JA).
 */
import { describe, expect, it } from "vitest";
import { resolveMessage } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import {
  barTooltipMessage,
  MODEL_TABLE_HEADER_KEYS,
  showMoreMessage,
} from "./modelsView";

describe("MODEL_TABLE_HEADER_KEYS", () => {
  it("maps every column header to its models.table.* key", () => {
    expect(MODEL_TABLE_HEADER_KEYS).toEqual({
      model: "models.table.model",
      input: "models.table.input",
      output: "models.table.output",
      usage: "models.table.usage",
    });
  });
});

describe("barTooltipMessage", () => {
  it("builds a descriptor with a pre-formatted date string and a numeric token total", () => {
    expect(barTooltipMessage({ tokens: 4200 }, "2024-06-18")).toEqual({
      key: "models.usage.barTooltip",
      params: { date: "2024-06-18", tokens: 4200 },
    });
  });
});

describe("showMoreMessage", () => {
  it("expanded → the showLess key with no params", () => {
    expect(showMoreMessage(true, 12)).toEqual({ key: "models.table.showLess" });
  });

  it("collapsed → the showMore key with the hidden count", () => {
    expect(showMoreMessage(false, 3)).toEqual({
      key: "models.table.showMore",
      params: { count: 3 },
    });
  });
});

describe("rendered strings (EN + JA)", () => {
  const tEn = createTranslator("en");
  const tJa = createTranslator("ja");

  it("barTooltipMessage", () => {
    const message = barTooltipMessage({ tokens: 12_345 }, "Jun 18");
    // Expected text is derived through the same key + params via the real
    // kernel (not hand-interpolated) so a catalog reword of the template or
    // the "tokens" wording doesn't spuriously break this test.
    expect(resolveMessage(message, tEn)).toBe(
      tEn("models.usage.barTooltip", { date: "Jun 18", tokens: 12_345 }),
    );
    expect(resolveMessage(message, tJa)).toBe(
      tJa("models.usage.barTooltip", { date: "Jun 18", tokens: 12_345 }),
    );
    // The locale genuinely changes the wording — guards against a fallback
    // that would otherwise pass both assertions above.
    expect(resolveMessage(message, tJa)).not.toBe(resolveMessage(message, tEn));
  });

  it("showMoreMessage collapsed/expanded", () => {
    const collapsed = showMoreMessage(false, 3);
    const expanded = showMoreMessage(true, 3);
    expect(resolveMessage(collapsed, tEn)).toBe(
      tEn("models.table.showMore", { count: 3 }),
    );
    expect(resolveMessage(collapsed, tJa)).toBe(
      tJa("models.table.showMore", { count: 3 }),
    );
    expect(resolveMessage(expanded, tEn)).toBe(tEn("models.table.showLess"));
    expect(resolveMessage(expanded, tJa)).toBe(tJa("models.table.showLess"));
    expect(resolveMessage(collapsed, tJa)).not.toBe(resolveMessage(collapsed, tEn));
    expect(resolveMessage(expanded, tJa)).not.toBe(resolveMessage(expanded, tEn));
  });
});
