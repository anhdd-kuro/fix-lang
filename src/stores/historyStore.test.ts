/**
 * @file historyStore.test.ts
 * @description Unit tests for historyStore. The store is now a thin adapter
 * over the SQLite repository, so the CRUD functions are tested by asserting
 * they delegate to the repo (the repo's own behavior — uncapped storage,
 * round-trips, range queries — is covered in historyRepo.test.ts). The pure
 * helpers (filterHistoryByPreset, mergeLegacyHistoryEntries) live in
 * historyTypes and are re-exported here; their suites are unchanged.
 *
 * Tests run in Node (no Electron context). historyDb is mocked so no real
 * electron/userData path is touched; electron-store is mocked for the
 * lastActionHistory pointer.
 */
// vi.mock calls must precede the module-under-test imports (mocks are
// registered before the SUT resolves its deps), which conflicts with
// import-x/order grouping — disabled file-wide for this test.
/* eslint-disable import-x/order */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the SQLite repo behind historyDb so the store delegates to a spy.
// ---------------------------------------------------------------------------
const repoMock = {
  getByFeature: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  overrideFeature: vi.fn(),
  getByRange: vi.fn(),
  migrateLegacyBuckets: vi.fn(),
};

vi.mock("./historyDb", () => ({
  getHistoryRepo: () => repoMock,
}));

// electron-store is only used for the lastActionHistory pointer now.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock; Store.get/set accept any shape
const storeMap = new Map<string, any>();
vi.mock("electron-store", () => {
  return {
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

import {
  addHistoryEntry,
  clearHistory,
  filterHistoryByPreset,
  getHistory,
  mergeLegacyHistoryEntries,
  overrideHistory,
  removeHistoryEntry,
} from "./historyStore";
import type { HistoryEntry } from "./historyStore";

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  original: "hello",
  corrected: "hello world",
  timestamp: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  storeMap.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// CRUD functions delegate to the SQLite repo (no cap, no in-memory trimming).
// ---------------------------------------------------------------------------

describe("addHistoryEntry", () => {
  it("delegates the entry to the repo (no trimming)", () => {
    const entry = makeEntry({ presetName: "Correction" });
    addHistoryEntry("corrections", entry);

    expect(repoMock.insert).toHaveBeenCalledTimes(1);
    expect(repoMock.insert).toHaveBeenCalledWith("corrections", entry);
  });

  it("ignores the inert maxEntries argument (uncapped)", () => {
    const entry = makeEntry();
    addHistoryEntry("corrections", entry, 1);
    // Delegation happens regardless of the legacy cap argument.
    expect(repoMock.insert).toHaveBeenCalledWith("corrections", entry);
  });
});

describe("CRUD delegation", () => {
  it("getHistory reads from the repo by feature", () => {
    const entries = [makeEntry()];
    repoMock.getByFeature.mockReturnValueOnce(entries);
    expect(getHistory("corrections")).toBe(entries);
    expect(repoMock.getByFeature).toHaveBeenCalledWith("corrections");
  });

  it("removeHistoryEntry delegates to repo.remove", () => {
    const entry = makeEntry();
    removeHistoryEntry("promptGen", entry);
    expect(repoMock.remove).toHaveBeenCalledWith("promptGen", entry);
  });

  it("clearHistory delegates to repo.clear", () => {
    clearHistory("corrections");
    expect(repoMock.clear).toHaveBeenCalledWith("corrections");
  });

  it("overrideHistory delegates to repo.overrideFeature", () => {
    const entries = [makeEntry()];
    overrideHistory("corrections", entries);
    expect(repoMock.overrideFeature).toHaveBeenCalledWith(
      "corrections",
      entries
    );
  });
});

// ---------------------------------------------------------------------------
// filterHistoryByPreset (pure function, no store dependency)
// ---------------------------------------------------------------------------

describe("filterHistoryByPreset", () => {
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

  it("returns only the PromptGen entry when filtering by PromptGen", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: "Correction" }),
      makeEntry({ presetName: "PromptGen" }),
    ];
    const result = filterHistoryByPreset(entries, "PromptGen");
    expect(result).toHaveLength(1);
    expect(result[0].presetName).toBe("PromptGen");
  });

  it("returns empty array without throwing when input is empty", () => {
    expect(filterHistoryByPreset([], "anything")).toEqual([]);
  });

  it("excludes legacy entries that have no presetName", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: undefined }),
      makeEntry({ presetName: "Correction" }),
    ];
    const result = filterHistoryByPreset(entries, "Correction");
    expect(result).toHaveLength(1);
    expect(result[0].presetName).toBe("Correction");

    const legacy = filterHistoryByPreset(entries, "");
    expect(legacy).toHaveLength(0);
  });

  it("still matches entries by their original presetName after a rename scenario", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ presetName: "OldName" }),
      makeEntry({ presetName: "OldName" }),
      makeEntry({ presetName: "NewName" }),
    ];
    expect(filterHistoryByPreset(entries, "OldName")).toHaveLength(2);
    expect(filterHistoryByPreset(entries, "NewName")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeLegacyHistoryEntries — upgrade migration of retired buckets
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
    expect(result[0].presetName).toBe("Correction");
  });

  it("returns corrections unchanged when there are no legacy buckets", () => {
    const corrections = [makeEntry({ original: "a", timestamp: "2024-04-01T00:00:00Z" })];
    const result = mergeLegacyHistoryEntries(corrections, {});
    expect(result).toEqual(corrections);
  });
});
