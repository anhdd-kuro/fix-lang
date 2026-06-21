/**
 * @file historyStore.ts
 * @description History store public surface. Backing storage is SQLite
 * (`node:sqlite`) via `historyRepo.ts` / `historyDb.ts`; this module is a thin
 * adapter that preserves the long-standing exported function/type surface so
 * IPC, preload, and renderer callers need no changes.
 *
 * Types + pure helpers live in the electron-free `historyTypes.ts` (so the
 * repo and tests can import them without an Electron context) and are
 * re-exported here unchanged. `lastActionHistory` (a single-row UI pointer,
 * not analytics data) stays electron-store-backed. The electron-store instance
 * is constructed lazily so importing this module does not require Electron.
 */
import Store from "electron-store";
import { getHistoryRepo } from "./historyDb";
import type {
  HistoryEntry,
  HistoryFeatureId,
  HistoryStore,
  LastActionHistory,
} from "./historyTypes";
import type { Schema } from "electron-store";

// Re-export the electron-free types + pure helpers so the public surface of
// this module is unchanged for all existing importers.
export {
  filterHistoryByPreset,
  mergeLegacyHistoryEntries,
} from "./historyTypes";
export type {
  HistoryEntry,
  HistoryFeatureId,
  HistoryStore,
  HistoryStoreType,
  LegacyHistoryBuckets,
} from "./historyTypes";

// Schema for the electron-store JSON backing. Since history corrections/promptGen
// now live in SQLite, electron-store retains only the lastActionHistory pointer
// (plus, transiently, legacy buckets read once during migration). The
// corrections/promptGen keys remain in the schema so the legacy JSON written by
// previous versions still validates while we read it for the SQLite migration.
const historySchema: Schema<HistoryStore> = {
  corrections: {
    type: "array",
    default: [],
  },
  promptGen: {
    type: "array",
    default: [],
  },
  lastActionHistory: {
    type: "object",
    properties: {
      featureId: { type: "string" },
      entry: {
        type: "object",
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          timestamp: { type: "string" },
          promptTokens: { type: "number" },
          completionTokens: { type: "number" },
          model: { type: "string" },
          resolvedModel: { type: "string" },
        },
      },
    },
    default: {
      featureId: "",
      entry: {
        original: "",
        corrected: "",
        timestamp: "",
        promptTokens: 0,
        completionTokens: 0,
      },
    },
  },
};

// Lazily-constructed electron-store instance. Built on first use so merely
// importing this module does not require an Electron runtime.
let historyStoreInstance: Store<HistoryStore> | null = null;

const getHistoryStore = (): Store<HistoryStore> => {
  if (historyStoreInstance === null) {
    historyStoreInstance = new Store<HistoryStore>({
      name: "history",
      schema: historySchema,
      encryptionKey: "your-encryption-key", // Replace with actual encryption key
      fileExtension: "json",
    });
  }
  return historyStoreInstance;
};

export function getHistory(featureId: HistoryFeatureId): HistoryEntry[] {
  return getHistoryRepo().getByFeature(featureId);
}

export function clearHistory(featureId: HistoryFeatureId): void {
  getHistoryRepo().clear(featureId);
}

/**
 * Append a history entry. The `maxEntries` parameter is retained for source
 * compatibility but is now inert — history is uncapped (SQLite-backed), so no
 * trimming occurs regardless of the value passed.
 */
export function addHistoryEntry(
  featureId: HistoryFeatureId,
  entry: HistoryEntry,
  maxEntries = 100
): void {
  // maxEntries is intentionally inert (kept for source-compat); the SQLite
  // backing is uncapped. Reference it so lint does not flag it unused while we
  // preserve the public parameter name.
  void maxEntries;
  getHistoryRepo().insert(featureId, entry);
}

export const overrideHistory = (
  featureId: HistoryFeatureId,
  entries: HistoryEntry[]
): void => {
  getHistoryRepo().overrideFeature(featureId, entries);
};

export function removeHistoryEntry(
  featureId: HistoryFeatureId,
  entry: HistoryEntry
): void {
  getHistoryRepo().remove(featureId, entry);
}

export function setLastActionHistory(entry: HistoryEntry): void {
  getHistoryStore().set("lastActionHistory", entry);
}

export function getLastActionHistory(): LastActionHistory | null {
  return getHistoryStore().get("lastActionHistory");
}

export function clearLastActionHistory(): void {
  getHistoryStore().set("lastActionHistory", {});
}

/**
 * One-time migration: import existing electron-store history into SQLite.
 *
 * Reads the legacy `corrections` / `promptGen` buckets plus the retired
 * `translations` / `summarize` keys from the electron-store JSON, folds the
 * legacy buckets into corrections (via `mergeLegacyHistoryEntries`), and bulk-
 * inserts everything into SQLite inside a transaction. Idempotency is guarded
 * by a `meta` flag persisted in the SQLite DB itself, so it runs at most once
 * even if the legacy JSON lingers.
 *
 * The legacy `history.json` is intentionally NOT deleted (safe rollback).
 */
export const migrateLegacyHistoryBuckets = (): void => {
  const store = getHistoryStore() as unknown as {
    get: (key: string) => unknown;
  };

  const asEntries = (v: unknown): HistoryEntry[] =>
    Array.isArray(v) ? (v as HistoryEntry[]) : [];

  const corrections = asEntries(store.get("corrections"));
  const promptGen = asEntries(store.get("promptGen"));
  const translations = asEntries(store.get("translations"));
  const summarize = asEntries(store.get("summarize"));

  getHistoryRepo().migrateLegacyBuckets(corrections, promptGen, {
    translations,
    summarize,
  });
};
