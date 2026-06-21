/**
 * @file historyRepo.test.ts
 * @description Unit tests for the SQLite history repository, run against an
 * in-memory `DatabaseSync(":memory:")` — no Electron context. Covers CRUD,
 * range query, ordering, legacy migration, idempotency, and pure mappers.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createHistoryRepo,
  entryToParams,
  rowToEntry,
  type HistoryRepo,
} from "./historyRepo";
import { mergeLegacyHistoryEntries } from "./historyTypes";
import type { HistoryEntry } from "./historyTypes";

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  original: "hello",
  corrected: "hello world",
  timestamp: new Date().toISOString(),
  ...overrides,
});

let db: DatabaseSync;
let repo: HistoryRepo;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  repo = createHistoryRepo(db);
});

// Test 1 — round-trip including all optional fields.
describe("insert + getByFeature", () => {
  it("round-trips an entry including optional fields", () => {
    const entry = makeEntry({
      timestamp: "2024-01-01T00:00:00Z",
      promptTokens: 12,
      completionTokens: 34,
      model: "gpt-4o-mini",
      resolvedModel: "gpt-4o-mini-2024",
      presetName: "Correction",
    });
    repo.insert("corrections", entry);

    const result = repo.getByFeature("corrections");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry);
  });

  // Test 2 — NULL round-trip: omitted presetName reads back as undefined.
  it("reads back omitted optional fields as undefined (NULL round-trip)", () => {
    const entry = makeEntry({ timestamp: "2024-01-02T00:00:00Z" });
    repo.insert("corrections", entry);

    const [stored] = repo.getByFeature("corrections");
    expect(stored.presetName).toBeUndefined();
    expect(stored.promptTokens).toBeUndefined();
    expect(stored.completionTokens).toBeUndefined();
    expect(stored.model).toBeUndefined();
    expect(stored.resolvedModel).toBeUndefined();
    // No NULL keys leak in: shape equals the original minimal entry.
    expect(stored).toEqual(entry);
  });
});

// Test 3 — uncapped: 150 entries all persist.
describe("uncapped storage", () => {
  it("persists more than 100 entries (no cap)", () => {
    for (let i = 0; i < 150; i++) {
      repo.insert(
        "corrections",
        makeEntry({
          original: `entry-${i}`,
          timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(),
        })
      );
    }
    expect(repo.getByFeature("corrections")).toHaveLength(150);
  });
});

// Test 4 — remove deletes by timestamp; siblings remain.
describe("remove", () => {
  it("deletes by timestamp and leaves siblings intact", () => {
    const a = makeEntry({ original: "a", timestamp: "2024-01-01T00:00:00Z" });
    const b = makeEntry({ original: "b", timestamp: "2024-01-02T00:00:00Z" });
    repo.insert("corrections", a);
    repo.insert("corrections", b);

    repo.remove("corrections", a);

    const result = repo.getByFeature("corrections");
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("b");
  });
});

// Test 5 — clear is scoped to one feature.
describe("clear", () => {
  it("empties one feature but leaves the other intact", () => {
    repo.insert("corrections", makeEntry({ timestamp: "2024-01-01T00:00:00Z" }));
    repo.insert("promptGen", makeEntry({ timestamp: "2024-01-02T00:00:00Z" }));

    repo.clear("corrections");

    expect(repo.getByFeature("corrections")).toHaveLength(0);
    expect(repo.getByFeature("promptGen")).toHaveLength(1);
  });
});

// Test 6 — overrideFeature replaces a feature's rows atomically.
describe("overrideFeature", () => {
  it("replaces a feature's rows", () => {
    repo.insert("corrections", makeEntry({ original: "old", timestamp: "2024-01-01T00:00:00Z" }));

    const next = [
      makeEntry({ original: "new-1", timestamp: "2024-02-01T00:00:00Z" }),
      makeEntry({ original: "new-2", timestamp: "2024-02-02T00:00:00Z" }),
    ];
    repo.overrideFeature("corrections", next);

    const result = repo.getByFeature("corrections");
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.original).sort()).toEqual(["new-1", "new-2"]);
  });
});

// Tests 7–9 — range query window, feature filter, ordering.
describe("getByRange", () => {
  beforeEach(() => {
    repo.insert("corrections", makeEntry({ original: "c1", timestamp: "2024-01-01T00:00:00Z" }));
    repo.insert("corrections", makeEntry({ original: "c2", timestamp: "2024-02-01T00:00:00Z" }));
    repo.insert("corrections", makeEntry({ original: "c3", timestamp: "2024-03-01T00:00:00Z" }));
    repo.insert("promptGen", makeEntry({ original: "p1", timestamp: "2024-02-15T00:00:00Z" }));
  });

  // Test 7 — inclusive window.
  it("returns only entries inside the inclusive timestamp window", () => {
    const result = repo.getByRange({
      from: "2024-02-01T00:00:00Z",
      to: "2024-03-01T00:00:00Z",
    });
    const originals = result.map((e) => e.original);
    expect(originals).toContain("c2");
    expect(originals).toContain("c3");
    expect(originals).toContain("p1");
    expect(originals).not.toContain("c1");
  });

  // Test 8 — featureId scopes to one bucket.
  it("scopes to one feature when featureId is given", () => {
    const result = repo.getByRange({ featureId: "promptGen" });
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("p1");
  });

  // Test 9 — ordering is timestamp DESC (newest first).
  it("orders results newest first", () => {
    const result = repo.getByRange({ featureId: "corrections" });
    expect(result.map((e) => e.original)).toEqual(["c3", "c2", "c1"]);
  });
});

// Test 10 — migration of a legacy payload mirrors mergeLegacyHistoryEntries.
describe("migrateLegacyBuckets", () => {
  it("imports legacy buckets, folding translations/summarize into corrections", () => {
    const corrections = [
      makeEntry({ original: "fix", timestamp: "2024-02-01T00:00:00Z", presetName: "Correction" }),
    ];
    const promptGen = [
      makeEntry({ original: "gen", timestamp: "2024-02-02T00:00:00Z", presetName: "PromptGen" }),
    ];
    const translations = [
      makeEntry({ original: "bonjour", timestamp: "2024-01-01T00:00:00Z" }),
    ];
    const summarize = [
      makeEntry({ original: "tldr", timestamp: "2024-01-02T00:00:00Z" }),
    ];

    const did = repo.migrateLegacyBuckets(corrections, promptGen, {
      translations,
      summarize,
    });
    expect(did).toBe(true);

    const expectedCorrections = mergeLegacyHistoryEntries(corrections, {
      translations,
      summarize,
    });
    const storedCorrections = repo.getByFeature("corrections");
    expect(storedCorrections).toHaveLength(expectedCorrections.length);

    // Translations tagged Translate, summarize tagged Summarize.
    const byOriginal = new Map(storedCorrections.map((e) => [e.original, e]));
    expect(byOriginal.get("bonjour")?.presetName).toBe("Translate");
    expect(byOriginal.get("tldr")?.presetName).toBe("Summarize");
    expect(byOriginal.get("fix")?.presetName).toBe("Correction");

    expect(repo.getByFeature("promptGen").map((e) => e.original)).toEqual([
      "gen",
    ]);
  });

  // Test 11 — idempotency: second run is a no-op (no duplicate rows).
  it("runs once — a second migration is a no-op", () => {
    const corrections = [makeEntry({ original: "x", timestamp: "2024-01-01T00:00:00Z" })];

    expect(repo.migrateLegacyBuckets(corrections, [], {})).toBe(true);
    expect(repo.migrateLegacyBuckets(corrections, [], {})).toBe(false);

    expect(repo.getByFeature("corrections")).toHaveLength(1);
  });
});

// Test 12 — pure mapper invariants (NULL ↔ undefined).
describe("pure mappers", () => {
  it("entryToParams maps absent optional fields to null", () => {
    const params = entryToParams(
      "corrections",
      makeEntry({ timestamp: "2024-01-01T00:00:00Z" })
    );
    expect(params.preset_name).toBeNull();
    expect(params.prompt_tokens).toBeNull();
    expect(params.model).toBeNull();
    expect(params.feature_id).toBe("corrections");
  });

  it("rowToEntry maps null columns back to undefined", () => {
    const entry = rowToEntry({
      feature_id: "corrections",
      original: "a",
      corrected: "b",
      timestamp: "2024-01-01T00:00:00Z",
      prompt_tokens: null,
      completion_tokens: null,
      model: null,
      resolved_model: null,
      preset_name: null,
    });
    expect(entry).toEqual({
      original: "a",
      corrected: "b",
      timestamp: "2024-01-01T00:00:00Z",
    });
  });

  it("entryToParams → rowToEntry is a faithful round trip for populated fields", () => {
    const entry = makeEntry({
      timestamp: "2024-01-01T00:00:00Z",
      promptTokens: 1,
      completionTokens: 2,
      model: "m",
      resolvedModel: "rm",
      presetName: "P",
    });
    const p = entryToParams("corrections", entry);
    const back = rowToEntry({
      feature_id: p.feature_id,
      original: p.original,
      corrected: p.corrected,
      timestamp: p.timestamp,
      prompt_tokens: p.prompt_tokens,
      completion_tokens: p.completion_tokens,
      model: p.model,
      resolved_model: p.resolved_model,
      preset_name: p.preset_name,
    });
    expect(back).toEqual(entry);
  });
});
