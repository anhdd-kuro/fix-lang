/**
 * @file historyTypes.ts
 * @description Electron-free history types + pure helpers. Extracted from
 * historyStore so the SQLite repository (historyRepo.ts) and unit tests can
 * import them without pulling in the electron-store instance. historyStore
 * re-exports everything here to preserve its public surface.
 */

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

// Narrowed to only the two valid feature buckets. lastActionHistory is not a feature bucket.
export type HistoryFeatureId = "corrections" | "promptGen";

export type LastActionHistory = {
  featureId: HistoryFeatureId;
  entry: HistoryEntry;
};

export type HistoryStore = {
  corrections: HistoryEntry[];
  promptGen: HistoryEntry[];
  lastActionHistory: LastActionHistory;
};

export type HistoryStoreType = keyof HistoryStore;

/** Retired per-feature history buckets, still present in pre-upgrade stores. */
export type LegacyHistoryBuckets = {
  translations?: HistoryEntry[];
  summarize?: HistoryEntry[];
};

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
