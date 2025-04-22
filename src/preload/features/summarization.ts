// Summarization-related preload functionality
import { ipcRenderer } from "electron";
import type { VersionEntry } from "../preload-api.types";

/**
 * Exposes summarization-related functionality to the renderer process
 */
export const summarizationFeature = {
  /**
   * Requests summarization of the given text.
   */
  summarize: (
    text: string
  ): Promise<{
    success: boolean;
    summarizedText: string;
    promptTokens: number | null;
    completionTokens: number | null;
    error?: string;
  }> => {
    return ipcRenderer.invoke("summarize", text);
  },

  /**
   * Registers a callback for the 'summary-data' event from main process.
   */
  onSummaryData: (
    callback: (payload: {
      summarizedText: string;
      promptTokens: number | null;
      completionTokens: number | null;
      x: number;
      y: number;
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        summarizedText: string;
        promptTokens: number | null;
        completionTokens: number | null;
        x: number;
        y: number;
      }
    ) => callback(payload);
    ipcRenderer.on("summary-data", listener);
    return () => {
      ipcRenderer.removeListener("summary-data", listener);
    };
  },

  /**
   * Retrieves summarization settings from the main process.
   */
  getSummarizeSettings: (): Promise<{
    minLength: number;
    maxLength: number;
  }> => {
    return ipcRenderer.invoke("get-summarize-settings");
  },

  /**
   * Stores summarization settings in the main process.
   */
  setSummarizeSettings: (settings: {
    minLength: number;
    maxLength: number;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("set-summarize-settings", settings);
  },

  /**
   * Retrieves the summarization history entries
   */
  getSummarizeHistory: (): Promise<VersionEntry[]> => {
    return ipcRenderer.invoke("get-summarize-history");
  },

  /**
   * Clears summarization history
   */
  clearSummarizeHistory: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("clear-summarize-history");
  },

  /**
   * Registers a callback for summarize history updates
   */
  onSummarizeHistoryUpdated: (callback: () => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => callback();
    ipcRenderer.on("summarize-history-updated", listener);
    return () => {
      ipcRenderer.removeListener("summarize-history-updated", listener);
    };
  },
};
