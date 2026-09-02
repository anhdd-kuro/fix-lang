/**
 * @file historyRepo.test.ts
 * @description Unit tests for the SQLite history repository, run against an
 * in-memory `DatabaseSync(":memory:")` — no Electron context. Covers CRUD,
 * range query, ordering, legacy migration, idempotency, and pure mappers.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { PROVIDER_IDS } from "~/features/providers/shared/providers";
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

/**
 * The bounded read beside the uncapped one. The Ask hotkey calls this on every
 * press to name the last few transforms, so BOTH bounds have to be fixed by SQL
 * rather than applied afterwards — the row count by `LIMIT`, the columns by
 * naming them. Otherwise a long history means loading every `original`,
 * `corrected` and `session_json` value on the main thread to keep five preset
 * names.
 */
describe("getRecentByFeature", () => {
  const insertMany = (count: number): void => {
    for (let i = 0; i < count; i++) {
      repo.insert(
        "corrections",
        makeEntry({
          original: `entry-${i}`,
          presetName: `preset-${i}`,
          timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(),
        })
      );
    }
  };

  it("returns only the newest rows, most recent first", () => {
    insertMany(50);

    const recent = repo.getRecentByFeature("corrections", 5);

    expect(recent).toHaveLength(5);
    expect(recent.map((row) => row.presetName)).toEqual([
      "preset-49",
      "preset-48",
      "preset-47",
      "preset-46",
      "preset-45",
    ]);
  });

  it("returns names and times ONLY — never the transformed text", () => {
    // The privacy property is structural: these rows go into an Ask prompt, and
    // the columns that hold the user's text (`original`, `corrected`, and the
    // whole prompt/response snapshot in `session_json`) are never selected, so
    // there is nothing for a caller downstream to reach for by accident.
    repo.insert(
      "corrections",
      makeEntry({
        original: "the private paragraph",
        corrected: "the private paragraph, corrected",
        presetName: "Correction",
        sessionJson: '{"messages":[{"role":"user","content":"secret"}]}',
        timestamp: "2024-03-01T00:00:00Z",
      })
    );

    expect(repo.getRecentByFeature("corrections", 5)).toEqual([
      { presetName: "Correction", timestamp: "2024-03-01T00:00:00Z" },
    ]);
  });

  it("omits presetName entirely for a legacy row that never had one", () => {
    repo.insert("corrections", makeEntry({ timestamp: "2024-04-01T00:00:00Z" }));

    expect(repo.getRecentByFeature("corrections", 5)).toEqual([
      { timestamp: "2024-04-01T00:00:00Z" },
    ]);
  });

  it("returns everything when the history is shorter than the limit", () => {
    insertMany(3);

    expect(repo.getRecentByFeature("corrections", 20)).toHaveLength(3);
  });

  it("is scoped to one feature", () => {
    repo.insert("promptGen", makeEntry({ timestamp: "2024-06-01T00:00:00Z" }));
    insertMany(2);

    expect(repo.getRecentByFeature("promptGen", 20)).toHaveLength(1);
  });

  it("reads nothing for a non-positive limit rather than erroring", () => {
    insertMany(3);

    expect(repo.getRecentByFeature("corrections", 0)).toHaveLength(0);
    expect(repo.getRecentByFeature("corrections", -1)).toHaveLength(0);
  });

  it("reads nothing for a limit that is not a number — NaN binds as NULL, and LIMIT NULL is no limit at all", () => {
    insertMany(30);

    expect(repo.getRecentByFeature("corrections", Number.NaN)).toHaveLength(0);
    expect(
      repo.getRecentByFeature("corrections", Number.POSITIVE_INFINITY)
    ).toHaveLength(0);
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
      provider: null,
      resolved_model: null,
      preset_name: null,
      estimated_cost_usd: null,
      price_prompt: null,
      price_completion: null,
      session_json: null,
      cost_status: null,
      combo_run_id: null,
      combo_step_index: null,
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
      provider: p.provider,
      resolved_model: p.resolved_model,
      preset_name: p.preset_name,
      estimated_cost_usd: p.estimated_cost_usd,
      price_prompt: p.price_prompt,
      price_completion: p.price_completion,
      cost_status: p.cost_status,
      session_json: p.session_json,
      combo_run_id: p.combo_run_id,
      combo_step_index: p.combo_step_index,
    });
    expect(back).toEqual(entry);
  });

  it("round-trips sessionJson when present", () => {
    const entry = makeEntry({
      timestamp: "2024-01-01T00:00:00Z",
      sessionJson: '{"systemPrompt":"x","userPrompt":"y","messages":[],"model":"m","provider":"openai","responses":["z"],"promptTokens":1,"completionTokens":1}',
    });
    const p = entryToParams("corrections", entry);
    expect(p.session_json).toBe(entry.sessionJson);
    const back = rowToEntry({
      feature_id: p.feature_id,
      original: p.original,
      corrected: p.corrected,
      timestamp: p.timestamp,
      prompt_tokens: p.prompt_tokens,
      completion_tokens: p.completion_tokens,
      model: p.model,
      provider: p.provider,
      resolved_model: p.resolved_model,
      preset_name: p.preset_name,
      estimated_cost_usd: p.estimated_cost_usd,
      price_prompt: p.price_prompt,
      price_completion: p.price_completion,
      cost_status: p.cost_status,
      session_json: p.session_json,
      combo_run_id: p.combo_run_id,
      combo_step_index: p.combo_step_index,
    });
    expect(back.sessionJson).toBe(entry.sessionJson);
  });
});

// ---------------------------------------------------------------------------
// Cost snapshot (#56) — round-trip + NULL→undefined + column migration.
// ---------------------------------------------------------------------------
describe("cost snapshot persistence", () => {
  it("round-trips explicit provider metadata without changing legacy rows", () => {
    repo.insert(
      "corrections",
      makeEntry({ timestamp: "2024-04-30T00:00:00Z", provider: "openai" }),
    );
    expect(repo.getByFeature("corrections")[0]?.provider).toBe("openai");
  });

  // Driven by PROVIDER_IDS, not literals: a hand-written union passes for today's
  // providers and only starts dropping rows when a fourth one is added.
  it.each([...PROVIDER_IDS])(
    "round-trips the %s provider, driven by PROVIDER_IDS",
    (provider) => {
      repo.insert(
        "corrections",
        makeEntry({ timestamp: "2024-04-30T00:00:00Z", provider }),
      );
      const stored = repo.getByFeature("corrections").at(-1);
      expect(stored?.provider).toBe(provider);
    },
  );

  it("keeps an unrecognized provider column out of the entry entirely", () => {
    // "constructor" specifically: an inherited key, so a lookup-map
    // implementation of this check would read it as truthy.
    const entry = rowToEntry({
      feature_id: "corrections",
      original: "a",
      corrected: "b",
      timestamp: "2024-01-01T00:00:00Z",
      prompt_tokens: null,
      completion_tokens: null,
      model: null,
      provider: "constructor",
      resolved_model: null,
      preset_name: null,
      estimated_cost_usd: null,
      price_prompt: null,
      price_completion: null,
      session_json: null,
      cost_status: null,
      combo_run_id: null,
      combo_step_index: null,
    });
    expect(entry).not.toHaveProperty("provider");
  });

  it("round-trips cost fields including the cost_status discriminator", () => {
    const entry = makeEntry({
      timestamp: "2024-05-01T00:00:00Z",
      estimatedCostUsd: 0.006,
      pricePrompt: "0.000002",
      priceCompletion: "0.000008",
      costStatus: "ok",
    });
    repo.insert("corrections", entry);

    const [stored] = repo.getByFeature("corrections");
    expect(stored.estimatedCostUsd).toBeCloseTo(0.006, 10);
    expect(stored.pricePrompt).toBe("0.000002");
    expect(stored.priceCompletion).toBe("0.000008");
    expect(stored.costStatus).toBe("ok");
  });

  it("round-trips a genuine zero (local) distinctly from N/A", () => {
    repo.insert(
      "corrections",
      makeEntry({
        timestamp: "2024-05-02T00:00:00Z",
        estimatedCostUsd: 0,
        costStatus: "zero",
      })
    );
    const [stored] = repo.getByFeature("corrections");
    expect(stored.costStatus).toBe("zero");
    expect(stored.estimatedCostUsd).toBe(0);
  });

  it("reads cost fields back as undefined when absent (legacy → N/A)", () => {
    repo.insert(
      "corrections",
      makeEntry({ timestamp: "2024-05-03T00:00:00Z" })
    );
    const [stored] = repo.getByFeature("corrections");
    expect(stored.estimatedCostUsd).toBeUndefined();
    expect(stored.pricePrompt).toBeUndefined();
    expect(stored.priceCompletion).toBeUndefined();
    expect(stored.costStatus).toBeUndefined();
  });
});

describe("cost column migration (v1 table → v2)", () => {
  it("adds the cost columns to a pre-#56 table and reads old rows as N/A", () => {
    // Simulate a #53-era DB: history table WITHOUT cost columns + a legacy row.
    const legacyDb = new DatabaseSync(":memory:");
    legacyDb.exec(`
      CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id TEXT NOT NULL,
        original TEXT,
        corrected TEXT,
        timestamp TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        model TEXT,
        resolved_model TEXT,
        preset_name TEXT
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    legacyDb
      .prepare(
        "INSERT INTO history (feature_id, original, corrected, timestamp) VALUES (?,?,?,?)"
      )
      .run("corrections", "old", "old fixed", "2024-01-01T00:00:00Z");

    // createHistoryRepo → ensureSchema → ensureCostColumns must ALTER the table.
    const migratedRepo = createHistoryRepo(legacyDb);

    const cols = (
      legacyDb.prepare("PRAGMA table_info(history)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("estimated_cost_usd");
    expect(cols).toContain("price_prompt");
    expect(cols).toContain("price_completion");
    expect(cols).toContain("cost_status");
    expect(cols).toContain("session_json");

    const [old] = migratedRepo.getByFeature("corrections");
    expect(old.original).toBe("old");
    expect(old.estimatedCostUsd).toBeUndefined();
    expect(old.costStatus).toBeUndefined();

    // Idempotent: constructing again does not error or duplicate columns.
    createHistoryRepo(legacyDb);
    const cols2 = (
      legacyDb.prepare("PRAGMA table_info(history)").all() as { name: string }[]
    ).length;
    expect(cols2).toBe(cols.length);
  });
});

// ---------------------------------------------------------------------------
// Combo run columns (design H1) — round-trip + guarded migration on a
// pre-existing (pre-combo) database, mirroring the cost-column tests above.
// ---------------------------------------------------------------------------
describe("combo run columns", () => {
  it("round-trips comboRunId and comboStepIndex on a written row", () => {
    repo.insert(
      "corrections",
      makeEntry({
        timestamp: "2024-06-01T00:00:00Z",
        comboRunId: "run-abc",
        comboStepIndex: 2,
      })
    );
    const [stored] = repo.getByFeature("corrections");
    expect(stored.comboRunId).toBe("run-abc");
    expect(stored.comboStepIndex).toBe(2);
  });

  it("reads a row without combo fields back as valid, with both undefined", () => {
    repo.insert("corrections", makeEntry({ timestamp: "2024-06-02T00:00:00Z" }));
    const [stored] = repo.getByFeature("corrections");
    expect(stored.comboRunId).toBeUndefined();
    expect(stored.comboStepIndex).toBeUndefined();
    expect(stored).toEqual(
      makeEntry({ timestamp: "2024-06-02T00:00:00Z" })
    );
  });

  it("adds combo columns idempotently to a pre-existing (pre-combo) database", () => {
    // Simulate a DB created before combo shipped: full v2 (cost columns present,
    // no combo_run_id/combo_step_index) history table + one real row.
    const legacyDb = new DatabaseSync(":memory:");
    legacyDb.exec(`
      CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id TEXT NOT NULL,
        original TEXT,
        corrected TEXT,
        timestamp TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        model TEXT,
        provider TEXT,
        resolved_model TEXT,
        preset_name TEXT,
        estimated_cost_usd REAL,
        price_prompt TEXT,
        price_completion TEXT,
        cost_status TEXT,
        session_json TEXT
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    legacyDb
      .prepare(
        "INSERT INTO history (feature_id, original, corrected, timestamp) VALUES (?,?,?,?)"
      )
      .run("corrections", "pre-combo", "pre-combo fixed", "2024-01-01T00:00:00Z");

    // Opening through the repo must ALTER the table to add both combo columns.
    const migratedRepo = createHistoryRepo(legacyDb);

    const cols = (
      legacyDb.prepare("PRAGMA table_info(history)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("combo_run_id");
    expect(cols).toContain("combo_step_index");

    // The pre-existing row still reads back fine, combo fields absent (N/A).
    const [old] = migratedRepo.getByFeature("corrections");
    expect(old.original).toBe("pre-combo");
    expect(old.comboRunId).toBeUndefined();
    expect(old.comboStepIndex).toBeUndefined();

    // Re-opening the SAME (now-migrated) database is a no-op: nothing throws,
    // no duplicate columns, no duplicate rows.
    expect(() => createHistoryRepo(legacyDb)).not.toThrow();
    const cols2 = (
      legacyDb.prepare("PRAGMA table_info(history)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols2).toEqual(cols);
    expect(migratedRepo.getByFeature("corrections")).toHaveLength(1);

    // The new columns are usable immediately after migration.
    migratedRepo.insert(
      "corrections",
      makeEntry({
        timestamp: "2024-06-03T00:00:00Z",
        comboRunId: "run-xyz",
        comboStepIndex: 0,
      })
    );
    const stored = migratedRepo
      .getByFeature("corrections")
      .find((e) => e.comboRunId === "run-xyz");
    expect(stored?.comboStepIndex).toBe(0);
  });
});
