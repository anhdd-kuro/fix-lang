// PromptGen-related preload functionality
import { ipcRenderer } from "electron";
import type { VersionEntry } from "../preload-api.types";

/**
 * Exposes prompt generation functionality to the renderer process
 */
export const promptgenFeature = {
  /**
   * Registers a callback for promptgen-data event from main process.
   */
  onPromptGenData: (
    callback: (payload: {
      prompts: string[];
      promptTokens: number | null;
      completionTokens: number | null;
      x: number;
      y: number;
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        prompts: string[];
        promptTokens: number | null;
        completionTokens: number | null;
        x: number;
        y: number;
      }
    ) => callback(payload);
    ipcRenderer.on("promptgen-data", listener);
    return () => {
      ipcRenderer.removeListener("promptgen-data", listener);
    };
  },

  /**
   * Closes the prompt generation window.
   */
  closePromptGenWindow: (): void => {
    ipcRenderer.send("close-promptgen-window");
  },

  /**
   * Closes the prompt generation window and removes all promptgen-data listeners.
   * Note: This is a more aggressive approach that removes all listeners,
   * which is appropriate during window closure.
   */
  removePromptGenDataListener: (): void => {
    // Simply remove all listeners for this event
    ipcRenderer.removeAllListeners("promptgen-data");
    console.log("Removed all promptgen-data listeners");
  },

  /**
   * Retrieves prompt generation settings from the main process.
   */
  getPromptgenSettings: (): Promise<{
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
  }> => {
    return ipcRenderer.invoke("get-promptgen-settings");
  },

  /**
   * Stores prompt generation settings in the main process.
   */
  setPromptgenSettings: (settings: {
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("set-promptgen-settings", settings);
  },

  /**
   * Retrieves the prompt generation history entries
   */
  getPromptgenHistory: (): Promise<VersionEntry[]> => {
    return ipcRenderer.invoke("get-promptgen-history");
  },

  /**
   * Clears prompt generation history
   */
  clearPromptgenHistory: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("clear-promptgen-history");
  },
};
