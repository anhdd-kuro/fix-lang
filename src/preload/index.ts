// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

// Define the shape of the data expected from the main process
type TextUpdatePayload = {
  original: string;
  fixed: string;
};

// Log that preload script is being executed
console.log("Preload script is being executed");

// Expose a controlled API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Fetches the list of available OpenAI models using the stored API key.
   * @returns A promise resolving to { success: boolean, models?: Model[], error?: string }
   */
  fetchOpenAIModels: async () => {
    return await ipcRenderer.invoke("fetch-openai-models");
  },
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
   * Registers a callback for the 'start-loading' event from main process.
   * Allows renderer to show spinner when shortcut is triggered.
   */
  /**
   * Registers a callback for the 'start-loading' event from main process.
   * Shows the global spinner overlay when triggered.
   */
  onStartLoading: (callback: () => void) => {
    const listener = () => {
      ipcRenderer.send("show-spinner");
      callback();
    };
    ipcRenderer.on("start-loading", listener);
    return () => {
      ipcRenderer.removeListener("start-loading", listener);
      console.log("Preload: Removed start-loading listener.");
    };
  },

  /**
   * Registers a callback for the 'stop-loading' event from main process.
   * Hides the global spinner overlay when triggered.
   */
  onStopLoading: (callback: () => void) => {
    const listener = () => {
      ipcRenderer.send("hide-spinner");
      callback();
    };
    ipcRenderer.on("stop-loading", listener);
    return () => {
      ipcRenderer.removeListener("stop-loading", listener);
      console.log("Preload: Removed stop-loading listener.");
    };
  },

  /**
   * Fetches the stored OpenAI API key from the main process.
   * @returns A promise that resolves with the stored API key (string) or an empty string if none is set or on error.
   */
  getApiKey: (): Promise<string> => {
    console.log("Preload: Invoking get-api-key");
    return ipcRenderer.invoke("get-api-key");
  },

  /**
   * Sends the OpenAI API key to the main process to be stored securely.
   * @param apiKey The API key string to store.
   * @returns A promise that resolves with an object indicating success or failure (e.g., { success: true } or { success: false, error: 'message' }).
   */
  setApiKey: (
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> => {
    console.log(
      `Preload: Invoking set-api-key with key length: ${apiKey?.length ?? 0}`
    );
    return ipcRenderer.invoke("set-api-key", apiKey);
  },

  /**
   * Fetches the stored key bindings from the main process.
   * @returns A promise that resolves with the key bindings object.
   */
  getKeyBindings: (): Promise<any> => {
    // Using 'any' for now, will be typed via electron.d.ts
    console.log("Preload: Invoking get-key-bindings");
    return ipcRenderer.invoke("get-key-bindings");
  },

  /**
   * Sends the key bindings object to the main process to be stored.
   * @param bindings The key bindings object (e.g., { fix: 'Ctrl+F', undo: 'Ctrl+Z', retry: 'Ctrl+R' }).
   * @returns A promise that resolves with an object indicating success or failure.
   */
  setKeyBindings: (
    bindings: any
  ): Promise<{ success: boolean; error?: string }> => {
    console.log("Preload: Invoking set-key-bindings with:", bindings);
    return ipcRenderer.invoke("set-key-bindings", bindings);
  },

  // --- Potential Future Additions ---
  // getSettings: () => ipcRenderer.invoke('get-settings'),
  // setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
});

console.log(
  "Preload script executed and electronAPI exposed with the following methods:"
);
console.log("- onUpdateText");
console.log("- getApiKey");
console.log("- setApiKey");
console.log("- getKeyBindings");
console.log("- setKeyBindings");
