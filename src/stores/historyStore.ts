import Store from "electron-store";
import type { Schema } from "electron-store";

export type HistoryEntry = {
  original: string;
  corrected: string;
  timestamp: string;
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
};

type LastActionHistory = {
  featureId: HistoryFeatureId;
  entry: HistoryEntry;
};

export type HistoryStore = {
  corrections: HistoryEntry[];
  translations: HistoryEntry[];
  summarize: HistoryEntry[];
  promptGen: HistoryEntry[];
  lastActionHistory: LastActionHistory;
};

export type HistoryStoreType = keyof HistoryStore;

// Create schema based on the shared type definition
const historySchema: Schema<HistoryStore> = {
  corrections: {
    type: "array",
    default: [],
  },
  translations: {
    type: "array",
    default: [],
  },
  summarize: {
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

export type HistoryFeatureId = keyof HistoryStore;

export function getHistory(featureId: HistoryFeatureId): HistoryEntry[] {
  return historyStore.get(featureId) as HistoryEntry[];
}

export function clearHistory(featureId: HistoryFeatureId): void {
  historyStore.set(featureId, []);
}

export function addHistoryEntry(
  featureId: HistoryFeatureId,
  entry: HistoryEntry,
  maxEntries = 50
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
