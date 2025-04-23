// Translation-related preload functionality
import { ipcRenderer } from "electron";

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

/**
 * Exposes translation-related functionality to the renderer process
 */
export const translationFeature = {
  /**
   * Retrieves the stored translation target language.
   */
  getTranslationTargetLang: (): Promise<string> => {
    return ipcRenderer.invoke("get-translation-target-lang");
  },

  /**
   * Sets the translation target language.
   */
  setTranslationTargetLang: (
    lang: string
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke("set-translation-target-lang", lang);
  },

  /**
   * Requests translation of the given text.
   */
  translate: (text: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke("translate-text", text);
  },

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
    return () => {
      ipcRenderer.removeListener("translation-result", listener);
    };
  },

  /**
   * Registers a callback for translation errors.
   */
  onTranslationError: (callback: (error: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) =>
      callback(error);
    ipcRenderer.on("translation-error", listener);
    return () => {
      ipcRenderer.removeListener("translation-error", listener);
    };
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
    // First, if we already have cached data, call the callback immediately
    if (translationDataCache) {
      callback(translationDataCache);
    }

    // Then set up the listener for future updates
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
    return () => {
      ipcRenderer.removeListener("translation-data", listener);
    };
  },

  /**
   * Requests translation window to close.
   */
  closeTranslationWindow: (): void => {
    ipcRenderer.send("close-translation-window");
  },

  /**
   * Retrieves translation settings from the main process.
   */
  getTranslateSettings: (): Promise<{
    destinationLang: string;
    includeExplanation: boolean;
  }> => {
    return ipcRenderer.invoke("get-translate-settings");
  },

  /**
   * Stores translation settings in the main process.
   */
  setTranslateSettings: (settings: {
    destinationLang: string;
    includeExplanation: boolean;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("set-translate-settings", settings);
  },
};

export type TranslationFeature = typeof translationFeature;
