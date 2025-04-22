/**
 * @file historyManager.ts
 * @description Main process implementation of history storage and management
 */
import { ipcMain } from "electron";
import Store from "electron-store";
import { HISTORY_FEATURES } from "../../../stores/historyStore";
import type {
  HistoryStore,
  HistoryFeatureId,
  VersionEntry,
} from "../../../stores/historyStore";
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
const historyStore = new Store<HistoryStore>({
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
 * DO NOT use this function unless the original feature handlers are removed
 * This will cause conflicts with existing handlers
 */
export function setupLegacyHistoryHandlers() {
  console.warn(
    "DEPRECATED: setupLegacyHistoryHandlers should not be used with existing feature handlers"
  );
  // This functionality is now embedded directly in the feature modules
  // to avoid duplicate handler registration
}
