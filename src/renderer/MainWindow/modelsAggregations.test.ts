/**
 * @file modelsAggregations.test.ts
 * @description Pure unit tests for the Models per-model aggregation (#58). No
 * electron/sqlite/DOM. Range filtering is exercised via the shared
 * `filterByRange` (injected `now`) feeding `perModelBreakdown`.
 */
import { describe, expect, it } from "vitest";
import {
  UNKNOWN_MODEL_LABEL,
  groupKeyForEntry,
  perModelBreakdown,
} from "./modelsAggregations";
import { filterByRange } from "../analytics/shared";
import type { HistoryEntry } from "~/stores/historyStore";

const at = (year: number, month: number, day: number, hour = 12): string =>
  new Date(year, month - 1, day, hour, 0, 0).toISOString();

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  original: "o",
  corrected: "c",
  timestamp: at(2024, 6, 15),
  ...overrides,
});

const NOW = new Date(2024, 5, 20, 10, 0, 0); // 2024-06-20

describe("groupKeyForEntry", () => {
  it("prefers resolvedModel over model", () => {
    expect(
      groupKeyForEntry(entry({ model: "alias", resolvedModel: "openai/gpt-4o" }))
    ).toBe("openai/gpt-4o");
  });
  it("falls back to model when resolvedModel is absent/blank", () => {
    expect(groupKeyForEntry(entry({ model: "anthropic/claude" }))).toBe(
      "anthropic/claude"
    );
    expect(
      groupKeyForEntry(entry({ model: "m", resolvedModel: "   " }))
    ).toBe("m");
  });
  it("returns the unknown label when both are absent", () => {
    expect(groupKeyForEntry(entry({ model: undefined }))).toBe(
      UNKNOWN_MODEL_LABEL
    );
  });
});

describe("perModelBreakdown", () => {
  it("empty input → [] (no divide-by-zero)", () => {
    expect(perModelBreakdown([])).toEqual([]);
  });

  it("collapses entries sharing a served model into one row", () => {
    const rows = perModelBreakdown([
      entry({ resolvedModel: "openai/gpt-4o" }),
      entry({ resolvedModel: "openai/gpt-4o" }),
      entry({ resolvedModel: "anthropic/claude" }),
    ]);
    expect(rows).toHaveLength(2);
    const gpt = rows.find((r) => r.model === "openai/gpt-4o");
    expect(gpt?.usageCount).toBe(2);
  });

  it("usage shares sum to ~100% and single model → 100%", () => {
    const rows = perModelBreakdown([
      entry({ resolvedModel: "a" }),
      entry({ resolvedModel: "a" }),
      entry({ resolvedModel: "b" }),
      entry({ resolvedModel: "c" }),
    ]);
    const sum = rows.reduce((s, r) => s + r.usageSharePct, 0);
    expect(sum).toBeCloseTo(100, 6);

    const single = perModelBreakdown([entry({ resolvedModel: "only" })]);
    expect(single[0].usageSharePct).toBe(100);
  });

  it("sums tokens per model, missing tokens → 0", () => {
    const rows = perModelBreakdown([
      entry({ resolvedModel: "a", promptTokens: 100, completionTokens: 50 }),
      entry({ resolvedModel: "a", promptTokens: 10 }),
      entry({ resolvedModel: "a" }),
    ]);
    expect(rows[0].totalTokens).toBe(160);
  });

  it("cost is N/A-aware: sums only ok/zero, flags costHasNa", () => {
    const rows = perModelBreakdown([
      entry({ resolvedModel: "a", costStatus: "ok", estimatedCostUsd: 0.006 }),
      entry({ resolvedModel: "a", costStatus: "zero", estimatedCostUsd: 0 }),
      entry({ resolvedModel: "a", costStatus: "na" }),
    ]);
    const a = rows[0];
    expect(a.estimatedCostUsd).toBeCloseTo(0.006, 10);
    expect(a.pricedCount).toBe(2);
    expect(a.costHasNa).toBe(true);
  });

  it("an all-N/A model → estimatedCostUsd null (never 0), costHasNa true", () => {
    const rows = perModelBreakdown([
      entry({ resolvedModel: "a", costStatus: "na" }),
      entry({ resolvedModel: "a" }),
    ]);
    expect(rows[0].estimatedCostUsd).toBeNull();
    expect(rows[0].costHasNa).toBe(true);
  });

  it("sorts rows by usage count desc", () => {
    const rows = perModelBreakdown([
      entry({ resolvedModel: "low" }),
      entry({ resolvedModel: "high" }),
      entry({ resolvedModel: "high" }),
      entry({ resolvedModel: "high" }),
      entry({ resolvedModel: "mid" }),
      entry({ resolvedModel: "mid" }),
    ]);
    expect(rows.map((r) => r.model)).toEqual(["high", "mid", "low"]);
  });

  it("groups alias entries under their resolved id (alias indirection hidden)", () => {
    const rows = perModelBreakdown([
      entry({ model: "~openai/gpt-mini-latest", resolvedModel: "openai/gpt-5.4-mini" }),
      entry({ model: "openai/gpt-5.4-mini", resolvedModel: "openai/gpt-5.4-mini" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe("openai/gpt-5.4-mini");
    expect(rows[0].usageCount).toBe(2);
  });

  it("respects the range filter applied before grouping", () => {
    const entries = [
      entry({ resolvedModel: "a", timestamp: at(2024, 6, 20) }), // today
      entry({ resolvedModel: "b", timestamp: at(2024, 1, 1) }), // far past
    ];
    const rows7d = perModelBreakdown(filterByRange(entries, "7d", NOW));
    expect(rows7d).toHaveLength(1);
    expect(rows7d[0].model).toBe("a");

    const rowsAll = perModelBreakdown(filterByRange(entries, "all", NOW));
    expect(rowsAll).toHaveLength(2);
  });
});
