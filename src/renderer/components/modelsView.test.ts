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
  it("barTooltipMessage", () => {
    const message = barTooltipMessage({ tokens: 12_345 }, "Jun 18");
    expect(resolveMessage(message, createTranslator("en"))).toBe(
      "Jun 18 — 12,345 tokens",
    );
    expect(resolveMessage(message, createTranslator("ja"))).toBe(
      "Jun 18 — 12,345 トークン",
    );
  });

  it("showMoreMessage collapsed/expanded", () => {
    const collapsed = showMoreMessage(false, 3);
    const expanded = showMoreMessage(true, 3);
    expect(resolveMessage(collapsed, createTranslator("en"))).toBe("Show 3 more");
    expect(resolveMessage(collapsed, createTranslator("ja"))).toBe("他 3 件を表示");
    expect(resolveMessage(expanded, createTranslator("en"))).toBe("Show less");
    expect(resolveMessage(expanded, createTranslator("ja"))).toBe("表示を減らす");
  });
});
