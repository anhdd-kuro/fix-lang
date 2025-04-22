// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import type {
  ElectronAPI,
  KeyBindings,
  VersionEntry,
} from "./preload-api.types";

// Define the shape of the data expected from the main process
type TextUpdatePayload = {
  original: string;
  corrected: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

// Log that preload script is being executed
console.log("Preload script is being executed");

// Global cache for translation-data payload
let translationDataCache: {
  translatedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
  x: number;
  y: number;
  originalText?: string;
  targetLang?: string;
  loading?: boolean;
  error?: string;
} | null = null;

// Update cache on each translation-data event
ipcRenderer.on("translation-data", (_event, payload) => {
  translationDataCache = payload;
});

// Expose a controlled API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Fetches the list of available OpenAI models using the stored API key.
   * @returns A promise resolving to { success: boolean, models?: Model[], error?: string }
   */
  fetchOpenAIModels: async (refetch?: boolean) => {
    return await ipcRenderer.invoke("fetch-openai-models", refetch);
  },

  setSelectedModel: async (modelId: string) => {
    const result = await ipcRenderer.invoke("set-selected-model", modelId);
    ipcRenderer.send("settings-updated");
    return result;
  },

  getSelectedModel: async () => {
    return await ipcRenderer.invoke("get-selected-model");
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
  getKeyBindings: (): Promise<KeyBindings> => {
    // Using 'any' for now, will be typed via electron.d.ts
    console.log("Preload: Invoking get-key-bindings");
    return ipcRenderer.invoke("get-key-bindings");
  },

  /**
   * Sends the key bindings object to the main process to be stored.
   * @param bindings The key bindings object (e.g., { fix: 'Ctrl+F', undo: 'Ctrl+Z', retry: 'Ctrl+R' }).
   * @returns A promise that resolves with an object indicating success or failure.
   */
  setKeyBindings: async (
    bindings: KeyBindings
  ): Promise<{ success: boolean; error?: string }> => {
    console.log("Preload: Invoking set-key-bindings with:", bindings);
    const result = await ipcRenderer.invoke("set-key-bindings", bindings);
    ipcRenderer.send("settings-updated");
    return result;
  },

  /**
   * Resets key bindings to default values in the main process.
   */
  resetKeyBindings: (): Promise<KeyBindings> =>
    ipcRenderer.invoke("reset-key-bindings"),

  /**
   * Temporarily pause global shortcuts during editing.
   */
  pauseHotkeys: (): Promise<void> => ipcRenderer.invoke("pause-hotkeys"),

  /**
   * Resume global shortcuts after editing.
   */
  resumeHotkeys: (): Promise<void> => ipcRenderer.invoke("resume-hotkeys"),

  /**
   * Retrieves custom prompt settings from the main process.
   */
  getPromptSettings: (): Promise<{
    customSystemPrompt: string;
    customUserPrompt: string;
    withGrammar: boolean;
    withShorten: boolean;
    tone: string;
    temperature: number;
  }> => ipcRenderer.invoke("get-prompt-settings"),

  /**
   * Stores custom prompt settings in the main process.
   */
  setPromptSettings: async (settings: {
    customSystemPrompt: string;
    customUserPrompt: string;
    withGrammar: boolean;
    withShorten: boolean;
    tone: string;
    temperature: number;
  }): Promise<{ success: boolean; error?: string }> => {
    const result = await ipcRenderer.invoke("set-prompt-settings", settings);
    ipcRenderer.send("settings-updated");
    return result;
  },

  /**
   * Retrieves translation history entries
   */
  getTranslationHistory: (): Promise<VersionEntry[]> =>
    ipcRenderer.invoke("get-translation-history"),

  /**
   * Clears translation history
   */
  clearTranslationHistory: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("clear-translation-history"),

  /**
   * Registers a callback for opening the main settings modal.
   */
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-settings", listener);
    return () => ipcRenderer.removeListener("open-settings", listener);
  },
  /**
   * Registers a callback for "open-model-dialog" events.
   */
  onOpenModelDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-model-dialog", listener);
    return () => ipcRenderer.removeListener("open-model-dialog", listener);
  },
  /**
   * Registers a callback for "refresh-models" events.
   */
  onRefreshModels: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("refresh-models", listener);
    return () => ipcRenderer.removeListener("refresh-models", listener);
  },
  /**
   * Registers a callback for opening keybindings dialog.
   */
  onOpenKeybindingsDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-keybindings-dialog", listener);
    return () =>
      ipcRenderer.removeListener("open-keybindings-dialog", listener);
  },
  /**
   * Registers a callback for opening prompt settings dialog.
   */
  onOpenPromptDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-prompt-dialog", listener);
    return () => ipcRenderer.removeListener("open-prompt-dialog", listener);
  },
  /**
   * Registers a callback for opening history dialog.
   */
  onOpenHistoryDialog: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-history-dialog", listener);
    return () => ipcRenderer.removeListener("open-history-dialog", listener);
  },
  /**
   * Registers a callback for the 'tray-open' event with view and initialTab.
   */
  onTrayOpen: (
    callback: (args: { view: string; initialTab?: number }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      args: { view: string; initialTab?: number }
    ) => callback(args);
    ipcRenderer.on("tray-open", listener);
    return () => ipcRenderer.removeListener("tray-open", listener);
  },
  /**
   * Hides the tray window.
   */
  hideTray: (): void => ipcRenderer.send("hide-tray"),

  /**
   * Retrieves the stored translation target language.
   */
  getTranslationTargetLang: (): Promise<string> =>
    ipcRenderer.invoke("get-translation-target-lang"),

  /**
   * Sets the translation target language.
   */
  setTranslationTargetLang: (
    lang: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("set-translation-target-lang", lang),

  /**
   * Requests translation of the given text.
   */
  translate: (text: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("translate-text", text),

  /**
   * Registers a callback for translation results.
   */
  onTranslationResult: (
    callback: (payload: {
      translatedText: string;
      promptTokens: number | null;
      completionTokens: number | null;
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        translatedText: string;
        promptTokens: number | null;
        completionTokens: number | null;
      }
    ) => callback(payload);
    ipcRenderer.on("translation-result", listener);
    return () => ipcRenderer.removeListener("translation-result", listener);
  },

  /**
   * Registers a callback for translation errors.
   */
  onTranslationError: (callback: (error: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) =>
      callback(error);
    ipcRenderer.on("translation-error", listener);
    return () => ipcRenderer.removeListener("translation-error", listener);
  },

  /**
   * Registers a callback for raw translation data (for popup window).
   */
  onTranslationData: (
    callback: (payload: {
      translatedText: string;
      promptTokens: number | null;
      completionTokens: number | null;
      x: number;
      y: number;
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        translatedText: string;
        promptTokens: number | null;
        completionTokens: number | null;
        x: number;
        y: number;
      }
    ) => callback(payload);
    ipcRenderer.on("translation-data", listener);
    // Immediately invoke callback if cache exists
    if (translationDataCache) callback(translationDataCache);
    return () => ipcRenderer.removeListener("translation-data", listener);
  },

  /**
   * Requests translation window to close.
   */
  closeTranslationWindow: (): void =>
    ipcRenderer.send("close-translation-window"),

  /**
   * Copies given text to clipboard.
   */
  copyToClipboard: (text: string): Promise<{ success: boolean }> => {
    console.log("Preload: Invoking copy-to-clipboard");
    return ipcRenderer.invoke("copy-to-clipboard", text);
  },

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
  }> => ipcRenderer.invoke("summarize", text),

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
    ipcRenderer.on("summary-data", (_event, payload) => callback(payload));
    return () => ipcRenderer.removeAllListeners("summary-data");
  },

  quitApp: (): void => ipcRenderer.send("quit-app"),

  // --- Correct feature ---
  getCorrectSettings: (): Promise<{ tone: string; paraphrase: boolean }> =>
    ipcRenderer.invoke("get-correct-settings"),
  setCorrectSettings: async (settings: {
    tone: string;
    paraphrase: boolean;
  }): Promise<{ success: boolean }> => {
    const result = await ipcRenderer.invoke("set-correct-settings", settings);
    ipcRenderer.send("settings-updated");
    return result;
  },
  getCorrectHistory: (): Promise<VersionEntry[]> =>
    ipcRenderer.invoke("get-correct-history"),
  clearCorrectHistory: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("clear-correct-history"),

  // --- Summarize feature ---
  getSummarizeSettings: (): Promise<{ minLength: number; maxLength: number }> =>
    ipcRenderer.invoke("get-summarize-settings"),
  setSummarizeSettings: async (settings: {
    minLength: number;
    maxLength: number;
  }): Promise<{ success: boolean }> => {
    const result = await ipcRenderer.invoke("set-summarize-settings", settings);
    ipcRenderer.send("settings-updated");
    return result;
  },
  getSummarizeHistory: (): Promise<VersionEntry[]> =>
    ipcRenderer.invoke("get-summarize-history"),
  clearSummarizeHistory: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("clear-summarize-history"),

  // --- Translate feature ---
  getTranslateSettings: (): Promise<{
    destinationLang: string;
    includeExplanation: boolean;
  }> => ipcRenderer.invoke("get-translate-settings"),
  setTranslateSettings: async (settings: {
    destinationLang: string;
    includeExplanation: boolean;
  }): Promise<{ success: boolean }> => {
    const result = await ipcRenderer.invoke("set-translate-settings", settings);
    ipcRenderer.send("settings-updated");
    return result;
  },

  // --- PromptGen feature ---
  getPromptgenSettings: (): Promise<{
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
  }> => ipcRenderer.invoke("get-promptgen-settings"),

  setPromptgenSettings: async (settings: {
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
  }): Promise<{ success: boolean }> => {
    const result = await ipcRenderer.invoke("set-promptgen-settings", settings);
    ipcRenderer.send("settings-updated");
    return result;
  },

  getPromptgenHistory: (): Promise<VersionEntry[]> =>
    ipcRenderer.invoke("get-promptgen-history"),

  clearPromptgenHistory: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("clear-promptgen-history"),

  onSettingsUpdated: (callback: () => void): (() => void) => {
    ipcRenderer.on("settings-updated", () => callback());
    return () =>
      ipcRenderer.removeListener("settings-updated", () => callback());
  },

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
    ipcRenderer.on("promptgen-data", (_event, payload) => callback(payload));
    return () => ipcRenderer.removeAllListeners("promptgen-data");
  },

  /**
   * Closes the prompt generation window.
   */
  closePromptGenWindow: (): void => ipcRenderer.send("close-promptgen-window"),

  /**
   * Removes the promptgen-data event listener.
   */
  removePromptGenDataListener: (
    callback: (payload: {
      prompts: string[];
      promptTokens: number | null;
      completionTokens: number | null;
      x: number;
      y: number;
    }) => void
  ): void => {
    ipcRenderer.removeListener("promptgen-data", (_event, payload) =>
      callback(payload)
    );
  },
} satisfies ElectronAPI);

console.log(
  "Preload script executed and electronAPI exposed with the following methods:"
);
