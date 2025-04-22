// Unified history-related preload functionality
import { ipcRenderer } from "electron";

/**
 * A type representing the available history types in the application
 */
export type HistoryType =
  | "correction"
  | "translation"
  | "summarize"
  | "promptGen";

// History entry type directly defined here to avoid circular imports
export type HistoryEntry = {
  original: string;
  corrected: string;
  timestamp: string;
  promptTokens?: number;
  completionTokens?: number;
};

/**
 * Creates a set of history management functions for a specific feature
 * @param featureId - The ID of the history feature to manage
 */
const createHistoryFeature = (type: HistoryType) => {
  // Special case handling for promptGen to match existing handlers
  // that use promptGen (with capital G) instead of prompt-gen
  let kebabType;
  if (type === "promptGen") {
    kebabType = "promptGen"; // Preserve the capital G for this specific case
  } else {
    // Regular kebab-case conversion for other types
    kebabType = type.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  }

  // For backwards compatibility with existing IPC handlers
  // Some handlers don't follow the pattern exactly
  const getHistoryHandler =
    type === "correction" ? "get-correct-history" : `get-${kebabType}-history`;

  const clearHistoryHandler =
    type === "correction"
      ? "clear-correct-history"
      : `clear-${kebabType}-history`;

  const updateEvent = `${kebabType}-history-updated`;

  return {
    /**
     * Retrieves the history entries for this feature
     */
    getHistory: (): Promise<HistoryEntry[]> => {
      return ipcRenderer.invoke(getHistoryHandler);
    },

    /**
     * Clears the history for this feature
     */
    clearHistory: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(clearHistoryHandler);
    },

    /**
     * Registers a callback for history update events
     */
    onHistoryUpdated: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback();
      ipcRenderer.on(updateEvent, listener);
      return () => {
        ipcRenderer.removeListener(updateEvent, listener);
      };
    },
  };
};

/**
 * Exposes history management functionality for all features
 */
export const historyFeature = {
  correction: createHistoryFeature("correction"),
  translation: createHistoryFeature("translation"),
  summarize: createHistoryFeature("summarize"),
  promptGen: createHistoryFeature("promptGen"),
};
