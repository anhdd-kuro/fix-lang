/**
 * @file historyRepo.ts
 * @description SQLite-backed repository for correction/promptGen history.
 *
 * This module is intentionally electron-free: it accepts an injected
 * `DatabaseSync` so it can be unit-tested against `new DatabaseSync(":memory:")`.
 * The electron-touching DB lifecycle (userData path, file singleton) lives in
 * `historyDb.ts`. The store (`historyStore.ts`) delegates its CRUD surface here.
 *
 * `DatabaseSync` (node:sqlite) is synchronous; that is acceptable here because
 * the IPC handlers already wrap these calls and the work is local and fast.
 */
import { mergeLegacyHistoryEntries } from "./historyTypes";
import type {
  HistoryEntry,
  HistoryFeatureId,
  LegacyHistoryBuckets,
} from "./historyTypes";
import type { DatabaseSync } from "node:sqlite";

/**
 * Raw column shape returned by `node:sqlite` for a `history` row. SQLite stores
 * absent optional fields as NULL, which node:sqlite surfaces as `null`.
 */
type HistoryRow = {
  feature_id: string;
  original: string | null;
  corrected: string | null;
  timestamp: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  model: string | null;
  resolved_model: string | null;
  preset_name: string | null;
};

/** Bound parameters for an INSERT, mirroring `HistoryRow` column order. */
type HistoryInsertParams = {
  feature_id: string;
  original: string;
  corrected: string;
  timestamp: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  model: string | null;
  resolved_model: string | null;
  preset_name: string | null;
};

/** Inclusive timestamp window (+ optional feature filter) for analytics. */
export type HistoryRangeQuery = {
  from?: string;
  to?: string;
  featureId?: HistoryFeatureId;
};

export type HistoryRepo = {
  getByFeature: (featureId: HistoryFeatureId) => HistoryEntry[];
  insert: (featureId: HistoryFeatureId, entry: HistoryEntry) => void;
  remove: (featureId: HistoryFeatureId, entry: HistoryEntry) => void;
  clear: (featureId: HistoryFeatureId) => void;
  overrideFeature: (
    featureId: HistoryFeatureId,
    entries: HistoryEntry[]
  ) => void;
  getByRange: (range: HistoryRangeQuery) => HistoryEntry[];
  /**
   * Idempotently import legacy electron-store buckets (incl. retired
   * translations/summarize) into SQLite. Returns true if it performed the
   * import, false if it was already migrated (no-op).
   */
  migrateLegacyBuckets: (
    corrections: HistoryEntry[],
    promptGen: HistoryEntry[],
    legacy: LegacyHistoryBuckets
  ) => boolean;
};

const MIGRATION_META_KEY = "migrated_from_electron_store";

/**
 * Pure mapper — SQLite row → `HistoryEntry`. NULL columns round-trip back to
 * `undefined` so legacy entries (and `filterHistoryByPreset` behavior) are
 * preserved exactly. Exported for unit testing the NULL↔undefined invariant.
 */
export const rowToEntry = (row: HistoryRow): HistoryEntry => {
  const entry: HistoryEntry = {
    original: row.original ?? "",
    corrected: row.corrected ?? "",
    timestamp: row.timestamp,
  };
  if (row.prompt_tokens !== null) {
    entry.promptTokens = row.prompt_tokens;
  }
  if (row.completion_tokens !== null) {
    entry.completionTokens = row.completion_tokens;
  }
  if (row.model !== null) {
    entry.model = row.model;
  }
  if (row.resolved_model !== null) {
    entry.resolvedModel = row.resolved_model;
  }
  if (row.preset_name !== null) {
    entry.presetName = row.preset_name;
  }
  return entry;
};

/**
 * Pure mapper — `HistoryEntry` → INSERT params. Absent optional fields become
 * `null` (stored as NULL). Exported for unit testing the round-trip invariant.
 */
export const entryToParams = (
  featureId: HistoryFeatureId,
  entry: HistoryEntry
): HistoryInsertParams => ({
  feature_id: featureId,
  original: entry.original,
  corrected: entry.corrected,
  timestamp: entry.timestamp,
  prompt_tokens: entry.promptTokens ?? null,
  completion_tokens: entry.completionTokens ?? null,
  model: entry.model ?? null,
  resolved_model: entry.resolvedModel ?? null,
  preset_name: entry.presetName ?? null,
});

/**
 * Create the schema (idempotent). Separated so the DB lifecycle module can
 * call it at open time and tests can construct a ready table on `:memory:`.
 */
const ensureSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
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
    CREATE INDEX IF NOT EXISTS idx_history_ts ON history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_history_feature ON history(feature_id, timestamp);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
};

/**
 * Construct a history repository over an injected `DatabaseSync`. Tests pass
 * `new DatabaseSync(":memory:")`; production passes the userData file DB. The
 * schema is created on construction (idempotent).
 */
export const createHistoryRepo = (db: DatabaseSync): HistoryRepo => {
  ensureSchema(db);

  const insertStmt = db.prepare(
    `INSERT INTO history
       (feature_id, original, corrected, timestamp, prompt_tokens, completion_tokens, model, resolved_model, preset_name)
     VALUES
       (:feature_id, :original, :corrected, :timestamp, :prompt_tokens, :completion_tokens, :model, :resolved_model, :preset_name)`
  );

  const insertEntry = (featureId: HistoryFeatureId, entry: HistoryEntry): void => {
    insertStmt.run(entryToParams(featureId, entry));
  };

  const getByFeature = (featureId: HistoryFeatureId): HistoryEntry[] => {
    const rows = db
      .prepare(
        "SELECT * FROM history WHERE feature_id = ? ORDER BY timestamp DESC"
      )
      .all(featureId) as HistoryRow[];
    return rows.map(rowToEntry);
  };

  const insert = (featureId: HistoryFeatureId, entry: HistoryEntry): void => {
    insertEntry(featureId, entry);
  };

  const remove = (featureId: HistoryFeatureId, entry: HistoryEntry): void => {
    // Match removeHistoryEntry semantics: delete by timestamp within the feature.
    db.prepare(
      "DELETE FROM history WHERE feature_id = ? AND timestamp = ?"
    ).run(featureId, entry.timestamp);
  };

  const clear = (featureId: HistoryFeatureId): void => {
    db.prepare("DELETE FROM history WHERE feature_id = ?").run(featureId);
  };

  const overrideFeature = (
    featureId: HistoryFeatureId,
    entries: HistoryEntry[]
  ): void => {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM history WHERE feature_id = ?").run(featureId);
      for (const entry of entries) {
        insertEntry(featureId, entry);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const getByRange = (range: HistoryRangeQuery): HistoryEntry[] => {
    const clauses: string[] = [];
    // node:sqlite positional params; values pushed in clause order.
    const params: (string | number)[] = [];
    if (range.featureId !== undefined) {
      clauses.push("feature_id = ?");
      params.push(range.featureId);
    }
    if (range.from !== undefined) {
      clauses.push("timestamp >= ?");
      params.push(range.from);
    }
    if (range.to !== undefined) {
      clauses.push("timestamp <= ?");
      params.push(range.to);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM history ${where} ORDER BY timestamp DESC`)
      .all(...params) as HistoryRow[];
    return rows.map(rowToEntry);
  };

  const isMigrated = (): boolean => {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(MIGRATION_META_KEY) as { value: string } | undefined;
    return row?.value === "1";
  };

  const migrateLegacyBuckets = (
    corrections: HistoryEntry[],
    promptGen: HistoryEntry[],
    legacy: LegacyHistoryBuckets
  ): boolean => {
    if (isMigrated()) {
      return false;
    }

    // Reuse the existing fold/tag/dedupe logic for the corrections bucket.
    const mergedCorrections = mergeLegacyHistoryEntries(corrections, legacy);

    db.exec("BEGIN");
    try {
      for (const entry of mergedCorrections) {
        insertEntry("corrections", entry);
      }
      for (const entry of promptGen) {
        insertEntry("promptGen", entry);
      }
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
        MIGRATION_META_KEY,
        "1"
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return true;
  };

  return {
    getByFeature,
    insert,
    remove,
    clear,
    overrideFeature,
    getByRange,
    migrateLegacyBuckets,
  };
};
