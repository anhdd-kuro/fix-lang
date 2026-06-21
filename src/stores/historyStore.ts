import Store from "electron-store";
import type { Schema } from "electron-store";

export type HistoryEntry = {
  original: string;
  corrected: string;
  timestamp: string;
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
  resolvedModel?: string; // Concrete model the provider served (resolves alias indirection); optional so legacy entries remain valid
  presetName?: string; // Snapshot of the producing preset's name at write time; optional so legacy entries remain valid
};

type LastActionHistory = {
  featureId: HistoryFeatureId;
  entry: HistoryEntry;
};

export type HistoryStore = {
  corrections: HistoryEntry[];
  promptGen: HistoryEntry[];
  lastActionHistory: LastActionHistory;
};

export type HistoryStoreType = keyof HistoryStore;

// Create schema based on the shared type definition.
// translations and summarize keys have been retired — entries for those features
// now use the corrections bucket with a presetName snapshot.
// electron-store silently ignores any stale data under those keys in the JSON file.
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

// Create history store instance
export const historyStore = new Store<HistoryStore>({
  name: "history",
  schema: historySchema,
  encryptionKey: "your-encryption-key", // Replace with actual encryption key
  fileExtension: "json",
});

// Narrowed to only the two valid feature buckets. lastActionHistory is not a feature bucket.
export type HistoryFeatureId = "corrections" | "promptGen";

export function getHistory(featureId: HistoryFeatureId): HistoryEntry[] {
  return historyStore.get(featureId) as HistoryEntry[];
}

export function clearHistory(featureId: HistoryFeatureId): void {
  historyStore.set(featureId, []);
}

export function addHistoryEntry(
  featureId: HistoryFeatureId,
  entry: HistoryEntry,
  maxEntries = 100
): void {
  const history = getHistory(featureId);

  // Add new entry at the beginning
  const updatedHistory = [entry, ...history];

  // Trim to maximum number of entries
  const trimmedHistory = updatedHistory.slice(0, maxEntries);

  // Update the store
  historyStore.set(featureId, trimmedHistory);
}

export const overrideHistory = (
  featureId: HistoryFeatureId,
  entries: HistoryEntry[]
): void => {
  historyStore.set(featureId, entries);
};

export function removeHistoryEntry(
  featureId: HistoryFeatureId,
  entry: HistoryEntry
): void {
  const history = getHistory(featureId);
  const updatedHistory = history.filter((h) => h.timestamp !== entry.timestamp);
  historyStore.set(featureId, updatedHistory);
}

export function setLastActionHistory(entry: HistoryEntry): void {
  historyStore.set("lastActionHistory", entry);
}

export function getLastActionHistory(): LastActionHistory | null {
  return historyStore.get("lastActionHistory");
}

export function clearLastActionHistory(): void {
  historyStore.set("lastActionHistory", {});
}

/**
 * Pure helper — filters a flat array of history entries by preset name snapshot.
 * Entries without a presetName (legacy entries) are never returned by a named filter.
 * This function has no electron dependency and is the primary test seam for the
 * per-preset filter feature.
 */
export const filterHistoryByPreset = (
  entries: HistoryEntry[],
  presetName: string
): HistoryEntry[] => {
  return entries.filter((e) => e.presetName === presetName);
};

/** Retired per-feature history buckets, still present in pre-upgrade stores. */
export type LegacyHistoryBuckets = {
  translations?: HistoryEntry[];
  summarize?: HistoryEntry[];
};

/**
 * Pure helper — fold retired `translations` / `summarize` buckets into a single
 * corrections list. Legacy entries missing a presetName are tagged with the
 * matching preset name ("Translate" / "Summarize") so they remain visible and
 * filterable in the dynamic history UI. Existing corrections come first; legacy
 * entries are appended and de-duplicated by timestamp+original. No electron
 * dependency — this is the primary test seam for the upgrade migration.
 */
export const mergeLegacyHistoryEntries = (
  corrections: HistoryEntry[],
  legacy: LegacyHistoryBuckets
): HistoryEntry[] => {
  const tag = (
    entries: HistoryEntry[] | undefined,
    presetName: string
  ): HistoryEntry[] =>
    (entries ?? []).map((e) => (e.presetName ? e : { ...e, presetName }));

  const merged = [
    ...corrections,
    ...tag(legacy.translations, "Translate"),
    ...tag(legacy.summarize, "Summarize"),
  ];

  const seen = new Set<string>();
  return merged.filter((e) => {
    const key = `${e.timestamp}::${e.original}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const LEGACY_HISTORY_MIGRATION_FLAG = "_legacyBucketsMigrated";

/**
 * One-time migration: fold any retired `translations` / `summarize` history
 * buckets (written before those features became presets) into `corrections`,
 * tagged with a presetName, then clear the legacy keys. Guarded so it runs at
 * most once. Reads/writes the retired keys via an untyped escape since they are
 * no longer part of the schema.
 */
export const migrateLegacyHistoryBuckets = (): void => {
  const store = historyStore as unknown as {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    delete?: (key: string) => void;
  };

  if (store.get(LEGACY_HISTORY_MIGRATION_FLAG) === true) {
    return;
  }

  const asEntries = (v: unknown): HistoryEntry[] =>
    Array.isArray(v) ? (v as HistoryEntry[]) : [];

  const translations = asEntries(store.get("translations"));
  const summarize = asEntries(store.get("summarize"));

  if (translations.length > 0 || summarize.length > 0) {
    const corrections = asEntries(store.get("corrections"));
    store.set(
      "corrections",
      mergeLegacyHistoryEntries(corrections, { translations, summarize })
    );
  }

  // Clear the retired keys when the backing store supports deletion.
  store.delete?.("translations");
  store.delete?.("summarize");
  store.set(LEGACY_HISTORY_MIGRATION_FLAG, true);
};
