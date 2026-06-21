/**
 * @file historyStore.test.ts
 * @description Unit tests for historyStore — presetName tagging and filterHistoryByPreset.
 * Tests run in Node (no Electron context). electron-store is mocked with an in-memory Map.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHistoryEntry,
  filterHistoryByPreset,
  mergeLegacyHistoryEntries,
} from "./historyStore";
import type { HistoryEntry } from "./historyStore";

// ---------------------------------------------------------------------------
// Mock electron-store before the module under test resolves it.
// vi.mock is hoisted by vitest so the mock is in place before any imports run.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock; Store.get/set accept any shape
const storeMap = new Map<string, any>();

vi.mock("electron-store", () => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock class; constructor options are opaque in tests
    default: class MockStore {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic K/V store API
      get(key: string): any {
        return storeMap.get(key);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic K/V store API
      set(key: string, value: any): void {
        storeMap.set(key, value);
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  original: "hello",
  corrected: "hello world",
  timestamp: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  storeMap.clear();
  // Seed the corrections array as empty so addHistoryEntry can push onto it.
  storeMap.set("corrections", []);
  storeMap.set("promptGen", []);
});

// ---------------------------------------------------------------------------
// Test 1: addHistoryEntry persists presetName
// ---------------------------------------------------------------------------

describe("addHistoryEntry", () => {
  it("persists presetName on the stored entry", () => {
    const entry = makeEntry({ presetName: "Correction" });
    addHistoryEntry("corrections", entry);

    const stored = storeMap.get("corrections") as HistoryEntry[];
    expect(stored).toHaveLength(1);
    expect(stored[0].presetName).toBe("Correction");
  });
});

// ---------------------------------------------------------------------------
// Tests 2–7: filterHistoryByPreset (pure function, no store dependency)
// ---------------------------------------------------------------------------

describe("filterHistoryByPreset", () => {
  // Test 2: exact match — Correction
  it("returns only entries matching Correction preset", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "Summarize" }),
    ];
    const result = filterHistoryByPreset(entries, "Correction");
    expect(result).toHaveLength(2);
    result.forEach((e) => expect(e.presetName).toBe("Correction"));
  });

  // Test 3: exact match — Summarize
  it("returns only the Summarize entry when filtering by Summarize", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "Summarize" }),
    ];
    const result = filterHistoryByPreset(entries, "Summarize");
    expect(result).toHaveLength(1);
    expect(result[0].presetName).toBe("Summarize");
  });

  // Test 4: PromptGen bucket
  it("returns only the PromptGen entry when filtering by PromptGen", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "PromptGen" }),
    ];
    const result = filterHistoryByPreset(entries, "PromptGen");
    expect(result).toHaveLength(1);
    expect(result[0].presetName).toBe("PromptGen");
  });

  // Test 5: empty input
  it("returns empty array without throwing when input is empty", () => {
    expect(filterHistoryByPreset([], "anything")).toEqual([]);
  });

  // Test 6: legacy entries (no presetName) are excluded from named filters
  it("excludes legacy entries that have no presetName", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: undefined }),
      makeEntry({ presetName: "Correction" }),
    ];
    const result = filterHistoryByPreset(entries, "Correction");
    expect(result).toHaveLength(1);
    expect(result[0].presetName).toBe("Correction");

    // Legacy entry is not returned by any named filter
    const legacy = filterHistoryByPreset(entries, "");
    expect(legacy).toHaveLength(0);
  });

  // Test 7: rename immutability — old preset name on stored entries survives a "rename"
  it("still matches entries by their original presetName after a rename scenario", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: "OldName" }),
      makeEntry({ presetName: "OldName" }),
      makeEntry({ presetName: "NewName" }), // simulates renamed preset writing new entries
    ];
    expect(filterHistoryByPreset(entries, "OldName")).toHaveLength(2);
    expect(filterHistoryByPreset(entries, "NewName")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeLegacyHistoryEntries — upgrade migration of retired buckets (C4/C6)
// ---------------------------------------------------------------------------

describe("mergeLegacyHistoryEntries", () => {
  it("tags untagged legacy translations with the Translate preset name", () => {
    const corrections: HistoryEntry[] = [];
    const translations = [
      makeEntry({ original: "bonjour", timestamp: "2024-01-01T00:00:00Z" }),
    ];
    const result = mergeLegacyHistoryEntries(corrections, { translations });
    expect(result).toHaveLength(1);
    expect(result[0].presetName).toBe("Translate");
  });

  it("tags untagged legacy summarize entries with the Summarize preset name", () => {
    const result = mergeLegacyHistoryEntries(
      [],
      { summarize: [makeEntry({ original: "long text", timestamp: "2024-01-02T00:00:00Z" })] },
    );
    expect(result[0].presetName).toBe("Summarize");
  });

  it("preserves an existing presetName on legacy entries (no overwrite)", () => {
    const result = mergeLegacyHistoryEntries(
      [],
      {
        translations: [
          makeEntry({
            original: "x",
            timestamp: "2024-01-03T00:00:00Z",
            presetName: "Custom Translate",
          }),
        ],
      },
    );
    expect(result[0].presetName).toBe("Custom Translate");
  });

  it("keeps existing corrections first, then appends legacy entries", () => {
    const corrections = [
      makeEntry({ original: "fix me", timestamp: "2024-02-01T00:00:00Z", presetName: "Correction" }),
    ];
    const result = mergeLegacyHistoryEntries(corrections, {
      translations: [makeEntry({ original: "translate me", timestamp: "2024-01-01T00:00:00Z" })],
      summarize: [makeEntry({ original: "summarize me", timestamp: "2024-01-02T00:00:00Z" })],
    });
    expect(result).toHaveLength(3);
    expect(result[0].original).toBe("fix me");
    expect(result.map((e) => e.presetName)).toEqual([
      "Correction",
      "Translate",
      "Summarize",
    ]);
  });

  it("de-duplicates entries sharing timestamp + original", () => {
    const dup = makeEntry({ original: "dup", timestamp: "2024-03-01T00:00:00Z", presetName: "Correction" });
    const result = mergeLegacyHistoryEntries([dup], {
      translations: [makeEntry({ original: "dup", timestamp: "2024-03-01T00:00:00Z" })],
    });
    expect(result).toHaveLength(1);
    // The pre-existing corrections entry wins (kept first).
    expect(result[0].presetName).toBe("Correction");
  });

  it("returns corrections unchanged when there are no legacy buckets", () => {
    const corrections = [makeEntry({ original: "a", timestamp: "2024-04-01T00:00:00Z" })];
    const result = mergeLegacyHistoryEntries(corrections, {});
    expect(result).toEqual(corrections);
  });
});
