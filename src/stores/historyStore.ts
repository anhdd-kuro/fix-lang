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

// The schema definition will be moved to the main process

// Helper functions
export function getFeatureById(id: HistoryFeatureId) {
  const feature = HISTORY_FEATURES.find((feature) => feature.id === id);
  if (!feature) {
    throw new Error(`Feature with id ${id} not found`);
  }
  return feature;
}

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
