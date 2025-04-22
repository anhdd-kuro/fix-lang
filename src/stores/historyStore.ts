/**
 * @file historyManager.ts
 * @description Main process implementation of history storage and management
 */
import { ipcMain } from "electron";
import Store from "electron-store";
import type { Schema } from "electron-store";

// Create schema based on the shared type definition
const historySchema: Schema<HistoryStore> = {
  history: {
    type: "array",
    default: [],
  },
  translations: {
    type: "array",
    default: [],
  },
  historySummarize: {
    type: "array",
    default: [],
  },
  historyPromptGen: {
    type: "array",
    default: [],
  },
};

// Create history store instance
export const historyStore = new Store<HistoryStore>({
  name: "history",
  schema: historySchema,
  encryptionKey: "your-encryption-key", // Replace with actual encryption key
  fileExtension: "json",
});

/**
 * Get a feature configuration by its ID
 */
function getFeatureById(id: HistoryFeatureId) {
  const feature = HISTORY_FEATURES.find((feature) => feature.id === id);
  if (!feature) {
    throw new Error(`Feature with id ${id} not found`);
  }
  return feature;
}

/**
 * Get history entries for a specific feature
 */
function getHistory(featureId: HistoryFeatureId): VersionEntry[] {
  const feature = getFeatureById(featureId);
  return historyStore.get(feature.storeKey) as VersionEntry[];
}

/**
 * Clear history for a specific feature
 */
function clearHistory(featureId: HistoryFeatureId): void {
  const feature = getFeatureById(featureId);
  historyStore.set(feature.storeKey, []);
}

/**
 * Add new entry to history for a specific feature
 */
function addHistoryEntry(
  featureId: HistoryFeatureId,
  entry: VersionEntry,
  maxEntries = 50
): void {
  const feature = getFeatureById(featureId);
  const history = getHistory(featureId);

  // Add new entry at the beginning
  const updatedHistory = [entry, ...history];

  // Trim to maximum number of entries
  const trimmedHistory = updatedHistory.slice(0, maxEntries);

  // Update the store
  historyStore.set(feature.storeKey, trimmedHistory);
}

/**
 * Setup IPC handlers for history management
 */
export function setupHistoryManagerHandlers() {
  // Register centralized add-to-history handler
  ipcMain.handle(
    "add-history-entry",
    async (
      _event,
      {
        featureId,
        entry,
        maxEntries,
      }: {
        featureId: HistoryFeatureId;
        entry: VersionEntry;
        maxEntries?: number;
      }
    ) => {
      try {
        addHistoryEntry(featureId, entry, maxEntries);
        return { success: true };
      } catch (error) {
        console.error(`Failed to add history entry for ${featureId}:`, error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // This is just for future expansion - our current implementation uses
  // the feature-specific handlers defined below
}

/**
 * Export utility functions for feature-specific handlers to use
 * This avoids duplicate handler registration
 */
export const historyUtils = {
  getHistory,
  clearHistory,
  addHistoryEntry,
};

/**
 * @file historyStore.ts
 * @description Type definitions and configurations for history features
 */

// Type-safe configuration for all history features
export const HISTORY_FEATURES = [
  {
    id: "correction",
    storeKey: "history", // Legacy key for backward compatibility
    uiKey: "corrections", // Key used in UI
    ipcHandlers: {
      get: "get-correct-history",
      clear: "clear-correct-history",
      update: "correct-history-updated",
    },
  },
  {
    id: "translation",
    storeKey: "translations",
    uiKey: "translations",
    ipcHandlers: {
      get: "get-translation-history",
      clear: "clear-translation-history",
      update: "translation-history-updated",
    },
  },
  {
    id: "summarize",
    storeKey: "historySummarize",
    uiKey: "summarize",
    ipcHandlers: {
      get: "get-summarize-history",
      clear: "clear-summarize-history",
      update: "summarize-history-updated",
    },
  },
  {
    id: "promptGen",
    storeKey: "historyPromptGen",
    uiKey: "promptGen",
    ipcHandlers: {
      get: "get-promptGen-history", // Preserves camelCase for consistency with existing code
      clear: "clear-promptGen-history",
      update: "promptGen-history-updated",
    },
  },
] as const;

// Create a union type from the feature IDs
export type HistoryFeatureId = (typeof HISTORY_FEATURES)[number]["id"];

// Create a union type from the UI keys
export type HistoryUiKey = (typeof HISTORY_FEATURES)[number]["uiKey"];

// Type for version entries in history
export type VersionEntry = {
  original: string;
  corrected: string;
  timestamp: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
};

// Type for the history store
export type HistoryStore = {
  history: VersionEntry[]; // Legacy key for correction history
  translations: VersionEntry[];
  historySummarize: VersionEntry[];
  historyPromptGen: VersionEntry[];
};

export function getFeatureByUiKey(uiKey: HistoryUiKey) {
  const feature = HISTORY_FEATURES.find((feature) => feature.uiKey === uiKey);
  if (!feature) {
    throw new Error(`Feature with uiKey ${uiKey} not found`);
  }
  return feature;
}

export function mapUiKeyToFeatureId(uiKey: HistoryUiKey): HistoryFeatureId {
  const feature = getFeatureByUiKey(uiKey);
  return feature.id;
}

// These store operations will be implemented in the main process
