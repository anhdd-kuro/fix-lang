// PromptGen-related preload functionality
import { ipcRenderer } from "electron";

/**
 * Exposes prompt generation functionality to the renderer process
 */
export const promptGenFeature = {
  /**
   * Registers a callback for promptGen-data event from main process.
   */
  onPromptGenData: (
    callback: (payload: {
      prompts: string[];
      promptTokens: number | null;
      completionTokens: number | null;
      x: number;
      y: number;
      autoCopy: boolean;
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
        autoCopy: boolean;
      }
    ) => callback(payload);
    ipcRenderer.on("promptGen-data", listener);
    return () => {
      ipcRenderer.removeListener("promptGen-data", listener);
    };
  },

  /**
   * Closes the prompt generation window.
   */
  closePromptGenWindow: (): void => {
    ipcRenderer.send("close-promptGen-window");
  },

  /**
   * Closes the prompt generation window and removes all promptGen-data listeners.
   * Note: This is a more aggressive approach that removes all listeners,
   * which is appropriate during window closure.
   */
  removePromptGenDataListener: (): void => {
    // Simply remove all listeners for this event
    ipcRenderer.removeAllListeners("promptGen-data");
    console.log("Removed all promptGen-data listeners");
  },

  /**
   * Retrieves prompt generation settings from the main process.
   */
  getPromptGenSettings: (): Promise<{
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
  }> => {
    return ipcRenderer.invoke("get-promptGen-settings");
  },

  /**
   * Stores prompt generation settings in the main process.
   */
  setPromptGenSettings: (settings: {
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("set-promptGen-settings", settings);
  },
};

export type PromptGenFeature = typeof promptGenFeature;
