/**
 * @file modelsView.test.ts
 * @description Unit tests for the pure Models tab view helpers (Chunk 8).
 * Descriptor shape is asserted directly; rendered strings are asserted
 * through `createTranslator` (EN + JA).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetFormatCachesForTests,
  createFormatters,
} from "~/features/i18n/shared/format";
import { resolveMessage } from "~/features/i18n/shared/message";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  barDateLabel,
  barTooltipMessage,
  donutTooltipMessage,
  MODEL_BREAKDOWN_TITLE_KEY,
  MODEL_TABLE_HEADER_KEYS,
  MODEL_USAGE_CHART_KEYS,
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


describe("MODEL_BREAKDOWN_TITLE_KEY", () => {
  it("points at the Model Breakdown section title", () => {
    expect(MODEL_BREAKDOWN_TITLE_KEY).toBe("models.breakdown.title");
  });
});

describe("MODEL_USAGE_CHART_KEYS", () => {
  it("covers title, description, axis, and dataset label", () => {
    expect(MODEL_USAGE_CHART_KEYS).toEqual({
      title: "models.usage.chartTitle",
      description: "models.usage.chartDescription",
      yAxis: "models.usage.yAxis",
      datasetLabel: "models.usage.datasetLabel",
    });
  });
});

describe("donutTooltipMessage", () => {
  it("builds a pluralizable descriptor with a pre-formatted pct string", () => {
    expect(donutTooltipMessage({ usageCount: 3 }, "42.5")).toEqual({
      key: "models.breakdown.tooltip",
      params: { pct: "42.5", count: 3 },
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

describe("barDateLabel", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
    __resetFormatCachesForTests();
  });

  it("formats a bar's day key through the locale-aware formatDate, differing between en and ja, never the raw key", () => {
    const dayKey = "2024-06-18";
    const enLabel = barDateLabel(createFormatters("en").formatDate, dayKey);
    const jaLabel = barDateLabel(createFormatters("ja").formatDate, dayKey);

    expect(enLabel).not.toBe(dayKey);
    expect(jaLabel).not.toBe(dayKey);
    expect(enLabel).not.toBe(jaLabel);
    // Regression guard for Bug B (raw day key passed as `dateLabel`): a
    // locale-formatted label never contains the dense ISO day key verbatim.
    expect(enLabel).not.toContain(dayKey);
    expect(jaLabel).not.toContain(dayKey);
  });

  it("drives the real barTooltipMessage call site end to end (both locales)", () => {
    const dayKey = "2024-06-18";
    const enLabel = barDateLabel(createFormatters("en").formatDate, dayKey);
    const jaLabel = barDateLabel(createFormatters("ja").formatDate, dayKey);

    const enMessage = barTooltipMessage({ tokens: 12_345 }, enLabel);
    const jaMessage = barTooltipMessage({ tokens: 12_345 }, jaLabel);

    const tEn = createTranslator("en");
    const tJa = createTranslator("ja");
    const enText = resolveMessage(enMessage, tEn);
    const jaText = resolveMessage(jaMessage, tJa);
    expect(enText).not.toBe(jaText);
    expect(enText).not.toContain(dayKey);
    expect(jaText).not.toContain(dayKey);
  });

  it("keeps the calendar day correct in a negative-offset timezone (guards the UTC-midnight ISO-parse hazard)", () => {
    // "Pacific/Midway" is UTC-11. Handing the raw day key to `new
    // Date(dayKey)` parses it as UTC midnight, which renders as the
    // *previous* calendar day once formatted here.
    process.env.TZ = "Pacific/Midway";
    __resetFormatCachesForTests();

    const { formatDate } = createFormatters("en");
    const correct = barDateLabel(formatDate, "2026-01-01");
    const buggy = formatDate(new Date("2026-01-01"), { month: "short", day: "numeric" });

    expect(correct).toBe("Jan 1");
    expect(buggy).toBe("Dec 31");
    expect(correct).not.toBe(buggy);
  });
});
