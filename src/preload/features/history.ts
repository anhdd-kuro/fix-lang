// Unified history-related preload functionality
import { ipcRenderer } from "electron";
import type { SyncHistoryResponse } from "~/main/ipc/features";
import type { HistoryEntry, HistoryStoreType } from "~/stores/historyStore";

/**
 * Creates a set of history management functions for a specific feature
 * @param featureId - The ID of the history feature to manage
 */
const createHistoryFeature = () => {
  return {
    /**
     * Retrieves the history entries for this feature
     */
    getHistory: (type: HistoryStoreType): Promise<HistoryEntry[]> => {
      return ipcRenderer.invoke("get-history", type);
    },

    /**
     * Clears the history for this feature
     */
    clearHistory: (type: HistoryStoreType): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke("clear-history", type);
    },

    /**
     * Removes a single history entry
     */
    removeHistoryEntry: (
      type: HistoryStoreType,
      entry: HistoryEntry
    ): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke("remove-history-entry", {
        featureId: type,
        entry,
      });
    },

    /**
     * Adds a new history entry
     */
    addHistoryEntry: (
      entry: HistoryEntry,
      type: HistoryStoreType
    ): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke("add-history", {
        featureId: type,
        entry,
      });
    },

    getLastActionHistory: (): Promise<HistoryEntry | null> => {
      return ipcRenderer.invoke("get-last-action-history");
    },

    setLastActionHistory: (
      entry: HistoryEntry
    ): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke("set-last-action-history", entry);
    },

    onHistoryUpdate: (callback: (payload: SyncHistoryResponse) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: SyncHistoryResponse
      ) => callback(payload);
      ipcRenderer.on("sync-history", listener);
      console.log("onHistoryUpdate registered");

      // Return a cleanup function
      return () => {
        ipcRenderer.removeListener("sync-history", listener);
        console.log("Preload: Removed sync-history listener.");
      };
    },
  };
};

export const historyFeature = createHistoryFeature();

export type HistoryFeature = ReturnType<typeof createHistoryFeature>;
