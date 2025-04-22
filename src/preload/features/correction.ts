// Correction-related preload functionality
import { ipcRenderer } from "electron";
import type { TextUpdatePayload, VersionEntry } from "../preload-api.types";

/**
 * Exposes correction-related functionality to the renderer process
 */
export const correctionFeature = {
  /**
   * Registers a callback function to be executed when the 'update-text' IPC message
   * is received from the main process.
   * @param callback The function to call with the received text payload.
   * @returns A cleanup function to remove the IPC listener.
   */
  onUpdateText: (callback: (payload: TextUpdatePayload) => void) => {
    const listener = (
      event: Electron.IpcRendererEvent,
      payload: TextUpdatePayload
    ) => callback(payload);
    ipcRenderer.on("update-text", listener);

    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener("update-text", listener);
      console.log("Preload: Removed update-text listener.");
    };
  },

  /**
   * Retrieves correction settings from the main process.
   */
  getCorrectSettings: (): Promise<{ tone: string; paraphrase: boolean }> => {
    return ipcRenderer.invoke("get-correct-settings");
  },

  /**
   * Stores correction settings in the main process.
   */
  setCorrectSettings: (settings: {
    tone: string;
    paraphrase: boolean;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("set-correct-settings", settings);
  },

  /**
   * Retrieves the correction history entries
   */
  getCorrectHistory: (): Promise<VersionEntry[]> => {
    return ipcRenderer.invoke("get-correct-history");
  },

  /**
   * Clears the correction history
   */
  clearCorrectHistory: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("clear-correct-history");
  },

  /**
   * Retrieves the last correction history entry (most recent).
   */
  getLastHistory: (): Promise<{ original: string; corrected: string }> => {
    return ipcRenderer.invoke("get-last-history");
  },
};
