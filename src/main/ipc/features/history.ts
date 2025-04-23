import { BrowserWindow, ipcMain } from "electron";
import {
  addHistoryEntry,
  clearHistory,
  getHistory,
  getLastActionHistory,
  overrideHistory,
  removeHistoryEntry,
  setLastActionHistory,
} from "~/stores/historyStore";
import type { HistoryEntry, HistoryFeatureId } from "~/stores/historyStore";

type SyncHistoryPayload = {
  featureId: HistoryFeatureId;
} & (
  | {
      type: "add" | "remove";
      entry: HistoryEntry;
    }
  | {
      type: "clear";
    }
  | {
      type: "override";
      entries: HistoryEntry[];
    }
  | {
      type: "sync";
    }
);

export const syncHistory = (payload: SyncHistoryPayload) => {
  switch (payload.type) {
    case "add":
      addHistoryEntry(payload.featureId, payload.entry);
      break;
    case "remove":
      removeHistoryEntry(payload.featureId, payload.entry);
      break;
    case "clear":
      clearHistory(payload.featureId);
      break;
    case "override":
      overrideHistory(payload.featureId, payload.entries);
      break;
    case "sync":
      break;
  }

  const webContentsPayload = {
    ...payload,
    entries: getHistory(payload.featureId),
  };
  setLastActionHistory(webContentsPayload.entries[0]);
  console.log("syncHistory - webContentsPayload");

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("sync-history", webContentsPayload);
    }
  });

  return webContentsPayload;
};

export type SyncHistoryResponse = ReturnType<typeof syncHistory>;

/**
 * Setup IPC handlers for history management
 */
export function setupHistoryManagerHandlers() {
  ipcMain.handle(
    "add-history",
    async (
      _event,
      {
        featureId,
        entry,
      }: {
        featureId: HistoryFeatureId;
        entry: HistoryEntry;
      }
    ) => {
      try {
        syncHistory({ type: "add", featureId, entry });
        return { success: true };
      } catch (error) {
        console.error(`Failed to add history entry for ${featureId}:`, error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle("get-history", async (_event, featureId: HistoryFeatureId) => {
    try {
      return getHistory(featureId);
    } catch (error) {
      console.error("Error getting history:", error);
      return [];
    }
  });

  ipcMain.handle(
    "clear-history",
    async (_event, featureId: HistoryFeatureId) => {
      try {
        syncHistory({ type: "clear", featureId });
        return { success: true };
      } catch (error) {
        console.error("Error clearing history:", error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.on("sync-history", async (_event, { featureId }) => {
    try {
      console.log("sync-history event received");
      return syncHistory({ type: "sync", featureId });
    } catch (error) {
      console.error(`Failed to sync history for ${featureId}:`, error);
    }
  });

  ipcMain.handle("get-last-action-history", async (_event) => {
    try {
      return getLastActionHistory();
    } catch (error) {
      console.error("Error getting last action history:", error);
      return null;
    }
  });

  ipcMain.handle(
    "set-last-action-history",
    async (_event, { entry }: { entry: HistoryEntry }) => {
      try {
        setLastActionHistory(entry);
        return { success: true };
      } catch (error) {
        console.error("Error setting last action history:", error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
