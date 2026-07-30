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
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    });
  });

  it("accumulates requests, tokens and cost across calls", () => {
    autocompleteUsageStore.record(usage(100, 20, 0.001), today);
    autocompleteUsageStore.record(usage(150, 25, 0.002), today);

    expect(autocompleteUsageStore.getDay(today)).toEqual({
      date: "2026-07-31",
      requests: 2,
      promptTokens: 250,
      completionTokens: 45,
      estimatedCostUsd: 0.003,
    });
  });

  // Local providers report no token counts. The request still happened, so a
  // day reading zero requests would misreport what actually ran.
  it("counts a request whose token and cost figures are unavailable", () => {
    autocompleteUsageStore.record(usage(null, null, null), today);

    const day = autocompleteUsageStore.getDay(today);
    expect(day.requests).toBe(1);
    expect(day.promptTokens).toBe(0);
    expect(day.estimatedCostUsd).toBe(0);
  });

  it("keeps days separate", () => {
    const yesterday = new Date(2026, 6, 30, 12, 0);
    autocompleteUsageStore.record(usage(10, 1, 0.1), yesterday);
    autocompleteUsageStore.record(usage(20, 2, 0.2), today);

    expect(autocompleteUsageStore.getDay(yesterday).requests).toBe(1);
    expect(autocompleteUsageStore.getDay(today).promptTokens).toBe(20);
  });

  describe("getMonth", () => {
    it("sums only the days inside the calendar month", () => {
      autocompleteUsageStore.record(usage(10, 1, 0.1), new Date(2026, 6, 1, 9, 0));
      autocompleteUsageStore.record(usage(20, 2, 0.2), new Date(2026, 6, 31, 9, 0));
      autocompleteUsageStore.record(usage(999, 99, 9.9), new Date(2026, 5, 30, 9, 0));

      const month = autocompleteUsageStore.getMonth(today);
      expect(month.requests).toBe(2);
      expect(month.promptTokens).toBe(30);
      expect(month.estimatedCostUsd).toBeCloseTo(0.3);
    });

    it("is empty when nothing was recorded this month", () => {
      autocompleteUsageStore.record(usage(10, 1, 0.1), new Date(2026, 5, 30, 9, 0));

      expect(autocompleteUsageStore.getMonth(today).requests).toBe(0);
    });
  });

  // The file must not grow without bound as the feature runs every day.
  it("retains a bounded number of days, keeping the most recent", () => {
    for (let dayOffset = 0; dayOffset < 70; dayOffset += 1) {
      autocompleteUsageStore.record(usage(1, 1, 0), new Date(2026, 6, 31 - dayOffset, 9, 0));
    }

    const days = storeData.days as Record<string, unknown>;
    expect(Object.keys(days)).toHaveLength(62);
    expect(days["2026-07-31"]).toBeDefined();
  });
});
