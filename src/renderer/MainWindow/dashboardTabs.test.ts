/**
 * @file dashboardTabs.test.ts
 * @description Unit tests for the pure dashboard tab + history-filter helpers
 * (#54). No DOM testing library is installed (see plan HITL #4), so the React
 * shell is exercised only through these framework-free helpers.
 */
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_TABS,
  DEFAULT_DASHBOARD_TAB_INDEX,
  applyPresetFilter,
  bucketsForClear,
  clampTabIndex,
  deriveAvailableFilters,
  toggleFilter,
} from "./dashboardTabs";
import type { HistoryEntry } from "~/stores/historyStore";

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  original: "hello",
  corrected: "hello world",
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe("DASHBOARD_TABS", () => {
  it("exposes the four tabs in order Overview/History/Models/OpenRouter", () => {
    expect(DASHBOARD_TABS.map((t) => t.id)).toEqual([
      "overview",
      "history",
      "models",
      "openrouter",
    ]);
    expect(DASHBOARD_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "History",
      "Models",
      "OpenRouter",
    ]);
  });

  it("defaults the active tab to Overview (index 0)", () => {
    expect(DEFAULT_DASHBOARD_TAB_INDEX).toBe(0);
    expect(DASHBOARD_TABS[DEFAULT_DASHBOARD_TAB_INDEX].id).toBe("overview");
  });
});

describe("clampTabIndex", () => {
  it("clamps below range to 0", () => {
    expect(clampTabIndex(-3)).toBe(0);
  });
  it("clamps above range to the last index", () => {
    expect(clampTabIndex(99)).toBe(DASHBOARD_TABS.length - 1);
  });
  it("passes valid indices through (floored)", () => {
    expect(clampTabIndex(2)).toBe(2);
    expect(clampTabIndex(1.9)).toBe(1);
  });
  it("treats NaN as 0", () => {
    expect(clampTabIndex(Number.NaN)).toBe(0);
  });
});

describe("deriveAvailableFilters", () => {
  it("returns unique preset names in first-seen order with PromptGen appended last", () => {
    const entries = [
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "Translate" }),
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "PromptGen" }), // explicit PromptGen is folded in, not duplicated
    ];
    expect(deriveAvailableFilters(entries)).toEqual([
      "Correction",
      "Translate",
      "PromptGen",
    ]);
  });

  it("returns just PromptGen when there are no preset names", () => {
    expect(deriveAvailableFilters([makeEntry({ presetName: undefined })])).toEqual([
      "PromptGen",
    ]);
  });
});

describe("applyPresetFilter", () => {
  const entries = [
    makeEntry({ presetName: "Correction", original: "a" }),
    makeEntry({ presetName: "Translate", original: "b" }),
    makeEntry({ presetName: undefined, original: "legacy" }),
  ];

  it("returns all entries when filter is null", () => {
    expect(applyPresetFilter(entries, null)).toHaveLength(3);
  });

  it("narrows to the named preset", () => {
    const result = applyPresetFilter(entries, "Correction");
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("a");
  });

  it("excludes legacy (undefined presetName) entries from named filters", () => {
    expect(applyPresetFilter(entries, "Translate").map((e) => e.original)).toEqual([
      "b",
    ]);
  });
});

describe("toggleFilter", () => {
  it("selects a new filter when a different one is clicked", () => {
    expect(toggleFilter(null, "Correction")).toBe("Correction");
    expect(toggleFilter("Translate", "Correction")).toBe("Correction");
  });
  it("toggles back to null (All) when the active filter is clicked again", () => {
    expect(toggleFilter("Correction", "Correction")).toBeNull();
  });
});

describe("bucketsForClear", () => {
  it("clears both buckets for All (null)", () => {
    expect(bucketsForClear(null)).toEqual(["corrections", "promptGen"]);
  });
  it("clears only promptGen for the PromptGen filter", () => {
    expect(bucketsForClear("PromptGen")).toEqual(["promptGen"]);
  });
  it("clears the shared corrections bucket for any other preset", () => {
    expect(bucketsForClear("Translate")).toEqual(["corrections"]);
    expect(bucketsForClear("Correction")).toEqual(["corrections"]);
  });
});
