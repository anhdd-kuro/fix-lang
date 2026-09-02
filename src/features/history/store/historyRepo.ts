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
import { isProviderId } from "~/features/providers/shared/providers";
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
  provider: string | null;
  resolved_model: string | null;
  preset_name: string | null;
  // Cost snapshot columns (#56) — added via guarded ALTER TABLE migration.
  estimated_cost_usd: number | null;
  price_prompt: string | null;
  price_completion: string | null;
  cost_status: string | null;
  session_json: string | null;
  // Combo run columns — added via guarded ALTER TABLE, see ensureComboColumns.
  combo_run_id: string | null;
  combo_step_index: number | null;
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
  provider: string | null;
  resolved_model: string | null;
  preset_name: string | null;
  estimated_cost_usd: number | null;
  price_prompt: string | null;
  price_completion: string | null;
  cost_status: string | null;
  session_json: string | null;
  combo_run_id: string | null;
  combo_step_index: number | null;
};

/** Inclusive timestamp window (+ optional feature filter) for analytics. */
export type HistoryRangeQuery = {
  from?: string;
  to?: string;
  featureId?: HistoryFeatureId;
};

/**
 * What the newest-rows read returns: A NAME AND A TIME, nothing else.
 *
 * Deliberately NOT a `HistoryEntry`. Its one caller (`readRecentTransforms`,
 * which puts these into an Ask prompt) may never see `original`, `corrected` or
 * `session_json`, and a full entry would hand it all three and leave that rule
 * to downstream discipline. A type with no field to reach for cannot be
 * misused, and the SELECT below never loads the columns in the first place.
 */
export type RecentHistorySummary = {
  /** Absent for legacy rows written before the preset-name snapshot existed. */
  presetName?: string;
  timestamp: string;
};

/** The two columns {@link RecentHistorySummary} is built from. */
type RecentHistoryRow = {
  timestamp: string;
  preset_name: string | null;
};

export type HistoryRepo = {
  getByFeature: (featureId: HistoryFeatureId) => HistoryEntry[];
  /**
   * The newest `limit` rows of one feature, bounded in SQL and narrowed to
   * names and times — see {@link RecentHistorySummary}.
   */
  getRecentByFeature: (
    featureId: HistoryFeatureId,
    limit: number
  ) => RecentHistorySummary[];
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
  // Never inline this as a literal union: it type-checks fine while silently
  // dropping the provider off every row of a newly added provider.
  if (isProviderId(row.provider)) {
    entry.provider = row.provider;
  }
  if (row.resolved_model !== null) {
    entry.resolvedModel = row.resolved_model;
  }
  if (row.preset_name !== null) {
    entry.presetName = row.preset_name;
  }
  if (row.estimated_cost_usd !== null) {
    entry.estimatedCostUsd = row.estimated_cost_usd;
  }
  if (row.price_prompt !== null) {
    entry.pricePrompt = row.price_prompt;
  }
  if (row.price_completion !== null) {
    entry.priceCompletion = row.price_completion;
  }
  if (row.cost_status !== null) {
    // Stored as TEXT; the writer only ever persists the union values.
    entry.costStatus = row.cost_status as HistoryEntry["costStatus"];
  }
  if (row.session_json !== null) {
    entry.sessionJson = row.session_json;
  }
  if (row.combo_run_id !== null) {
    entry.comboRunId = row.combo_run_id;
  }
  if (row.combo_step_index !== null) {
    entry.comboStepIndex = row.combo_step_index;
  }
  return entry;
};

/**
 * Pure mapper — narrowed row → {@link RecentHistorySummary}. Its own mapper
 * rather than `rowToEntry` because the row it maps HAS no other columns: reusing
 * the full mapper would mean selecting them again. A NULL `preset_name` is left
 * off entirely (same NULL↔undefined rule as `rowToEntry`), which is what lets
 * the caller skip legacy rows by asking whether the name is there.
 */
export const rowToRecentSummary = (
  row: RecentHistoryRow
): RecentHistorySummary =>
  row.preset_name === null
    ? { timestamp: row.timestamp }
    : { presetName: row.preset_name, timestamp: row.timestamp };

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
  provider: entry.provider ?? null,
  resolved_model: entry.resolvedModel ?? null,
  preset_name: entry.presetName ?? null,
  estimated_cost_usd: entry.estimatedCostUsd ?? null,
  price_prompt: entry.pricePrompt ?? null,
  price_completion: entry.priceCompletion ?? null,
  cost_status: entry.costStatus ?? null,
  session_json: entry.sessionJson ?? null,
  combo_run_id: entry.comboRunId ?? null,
  combo_step_index: entry.comboStepIndex ?? null,
});

/**
 * Create the schema (idempotent). Separated so the DB lifecycle module can
 * call it at open time and tests can construct a ready table on `:memory:`.
 */
/**
 * Cost-snapshot columns (#56). Added to fresh tables in the CREATE below and
 * back-filled onto pre-existing tables via the guarded ALTER TABLE in
 * `ensureCostColumns`. Existing rows default to NULL ⇒ surface as N/A.
 */
const COST_COLUMNS: readonly { name: string; ddl: string }[] = [
  { name: "provider", ddl: "provider TEXT" },
  { name: "estimated_cost_usd", ddl: "estimated_cost_usd REAL" },
  { name: "price_prompt", ddl: "price_prompt TEXT" },
  { name: "price_completion", ddl: "price_completion TEXT" },
  { name: "cost_status", ddl: "cost_status TEXT" },
  { name: "session_json", ddl: "session_json TEXT" },
];

/**
 * Idempotently add the cost-snapshot columns to an already-created `history`
 * table. `CREATE TABLE IF NOT EXISTS` will not alter an existing table, so for
 * DBs created by #53 we add each missing column via `ALTER TABLE`, guarded by
 * `PRAGMA table_info`. SQLite defaults the new columns to NULL on existing rows
 * (→ N/A). Safe to run repeatedly and on `:memory:`.
 */
const ensureCostColumns = (db: DatabaseSync): void => {
  const existing = new Set(
    (db.prepare("PRAGMA table_info(history)").all() as { name: string }[]).map(
      (c) => c.name
    )
  );
  for (const column of COST_COLUMNS) {
    if (!existing.has(column.name)) {
      db.exec(`ALTER TABLE history ADD COLUMN ${column.ddl}`);
    }
  }
  // Record the schema version (informational; the column guard is authoritative).
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    "2"
  );
};

/**
 * Combo run columns (design H1). Both nullable: only rows written by a combo
 * step carry them, so every legacy row and every existing query stays valid
 * with no WHERE change. `combo_run_id` groups the N step-rows written by one
 * hotkey press; `combo_step_index` orders them. No UI reads these in v1 —
 * this lands the write path only. Mirrors `ensureCostColumns`'s guarded
 * ALTER TABLE pattern; safe to run repeatedly and on `:memory:`.
 */
const COMBO_COLUMNS: readonly { name: string; ddl: string }[] = [
  { name: "combo_run_id", ddl: "combo_run_id TEXT" },
  { name: "combo_step_index", ddl: "combo_step_index INTEGER" },
];

const ensureComboColumns = (db: DatabaseSync): void => {
  const existing = new Set(
    (db.prepare("PRAGMA table_info(history)").all() as { name: string }[]).map(
      (c) => c.name
    )
  );
  for (const column of COMBO_COLUMNS) {
    if (!existing.has(column.name)) {
      db.exec(`ALTER TABLE history ADD COLUMN ${column.ddl}`);
    }
  }
  // Record the schema version (informational; the column guard is authoritative).
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    "3"
  );
};

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
      provider TEXT,
      resolved_model TEXT,
      preset_name TEXT,
      estimated_cost_usd REAL,
      price_prompt TEXT,
      price_completion TEXT,
      cost_status TEXT,
      session_json TEXT,
      combo_run_id TEXT,
      combo_step_index INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_history_ts ON history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_history_feature ON history(feature_id, timestamp);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // Back-fill cost columns onto tables created before #56.
  ensureCostColumns(db);
  // Back-fill combo columns onto tables created before combo (design H1).
  ensureComboColumns(db);
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
       (feature_id, original, corrected, timestamp, prompt_tokens, completion_tokens, model, provider, resolved_model, preset_name, estimated_cost_usd, price_prompt, price_completion, cost_status, session_json, combo_run_id, combo_step_index)
     VALUES
       (:feature_id, :original, :corrected, :timestamp, :prompt_tokens, :completion_tokens, :model, :provider, :resolved_model, :preset_name, :estimated_cost_usd, :price_prompt, :price_completion, :cost_status, :session_json, :combo_run_id, :combo_step_index)`
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

  /**
   * The newest `limit` rows, bounded IN SQL rather than by slicing what
   * `getByFeature` returns — and bounded by COLUMNS as well as by rows.
   *
   * The difference matters on the one caller: the Ask hotkey reads this on
   * every press to name the last few transforms, and `getByFeature` has no
   * `LIMIT` at all — it materializes every row of an uncapped, SQLite-backed
   * history (the full `original` and `corrected` text columns included) on the
   * main thread just to keep five preset names. A `LIMIT` keeps that read the
   * same size whether the user has run ten transforms or ten thousand.
   *
   * `SELECT preset_name, timestamp`, never `SELECT *`: twenty rows of `*` still
   * pull `original`, `corrected` and — far larger than either — `session_json`,
   * the whole prompt/response snapshot, synchronously on the main thread, on
   * every single press. Naming the two columns makes "names and times only" a
   * property of the QUERY rather than a rule the caller has to keep.
   */
  const getRecentByFeature = (
    featureId: HistoryFeatureId,
    limit: number
  ): RecentHistorySummary[] => {
    // `Math.trunc(NaN)` is `NaN`, and `Math.max(0, NaN)` is NaN too — which
    // SQLite binds as NULL, and `LIMIT NULL` means NO LIMIT: the unbounded read
    // this function exists to avoid, reached by passing a value that was never
    // a number.
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
    const rows = db
      .prepare(
        "SELECT preset_name, timestamp FROM history WHERE feature_id = ? ORDER BY timestamp DESC LIMIT ?"
      )
      .all(featureId, safeLimit) as RecentHistoryRow[];
    return rows.map(rowToRecentSummary);
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
    getRecentByFeature,
    insert,
    remove,
    clear,
    overrideFeature,
    getByRange,
    migrateLegacyBuckets,
  };
};
