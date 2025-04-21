/**
 * Shared type definition for all APIs exposed by Electron preload script.
 * Import this type in both preload and global electron.d.ts for DRY and type-safe IPC.
 */

import type { Model } from "openai/resources.mjs";

export type TextUpdatePayload = {
  original: string;
  corrected: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

export type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
  /** Keybinding for translation */
  translate: string;
  /** Keybinding for summarize */
  summarize: string;
};

/**
 * Entry in version history of corrections.
 */
export type VersionEntry = {
  /** Original text before correction */
  original: string;
  /** Corrected text after processing */
  corrected: string;
  /** ISO timestamp when correction occurred */
  timestamp: string;
};

export type ElectronAPI = {
  /**
   * Fetches available OpenAI models via main process.
   */
  fetchOpenAIModels: (refetch?: boolean) => Promise<{
    success: boolean;
    models?: Model[];
    error?: string;
  }>;

  setSelectedModel: (
    modelId: string
  ) => Promise<{ success: boolean; error?: string }>;

  getSelectedModel: () => Promise<string>;

  /**
   * Registers a callback for the 'update-text' event from main process.
   */
  onUpdateText: (callback: (payload: TextUpdatePayload) => void) => () => void;

  /**
   * Registers a callback for the 'start-loading' event from main process.
   */
  onStartLoading: (callback: () => void) => () => void;

  onStopLoading: (callback: () => void) => () => void;

  /**
   * Registers a callback for the 'summary-data' event from main process.
   */
  onSummaryData: (callback: (payload: { summarizedText: string; promptTokens: number | null; completionTokens: number | null; x: number; y: number; }) => void) => () => void;

  /**
   * Fetches the stored OpenAI API key from the main process.
   */
  getApiKey: () => Promise<string>;

  /**
   * Stores the provided OpenAI API key in the main process.
   */
  setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

  /**
   * Fetches the stored key bindings object from the main process.
   */
  getKeyBindings: () => Promise<KeyBindings>;

  /**
   * Stores the provided key bindings object in the main process.
   */
  setKeyBindings: (
    bindings: KeyBindings
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * Temporarily pause global shortcuts during editing.
   */
  pauseHotkeys: () => Promise<void>;

  /**
   * Resume global shortcuts after editing.
   */
  resumeHotkeys: () => Promise<void>;

  /**
   * Resets key bindings to default values in the main process.
   */
  resetKeyBindings: () => Promise<KeyBindings>;

  /**
   * Retrieves custom prompt settings from main process.
   */
  getPromptSettings: () => Promise<{
    customSystemPrompt: string;
    customUserPrompt: string;
    withGrammar: boolean;
    withShorten: boolean;
    tone: string;
    temperature: number;
  }>;

  /**
   * Stores custom prompt settings in main process.
   */
  setPromptSettings: (settings: {
    customSystemPrompt: string;
    customUserPrompt: string;
    withGrammar: boolean;
    withShorten: boolean;
    tone: string;
    temperature: number;
  }) => Promise<{ success: boolean; error?: string }>;

  /**
   * Retrieves translation history entries
   */
  getTranslationHistory: () => Promise<VersionEntry[]>;

  /**
   * Clears translation history
   */
  clearTranslationHistory: () => Promise<{ success: boolean; error?: string }>;

  /**
   * Registers a callback for opening the main settings modal.
   */
  onOpenSettings: (callback: () => void) => () => void;

  /**
   * Registers a callback for "open-model-dialog" events.
   */
  onOpenModelDialog: (callback: () => void) => () => void;

  /**
   * Registers a callback for "refresh-models" events.
   */
  onRefreshModels: (callback: () => void) => () => void;

  /**
   * Registers a callback for opening keybindings dialog.
   */
  onOpenKeybindingsDialog: (callback: () => void) => () => void;

  /**
   * Registers a callback for opening prompt settings dialog.
   */
  onOpenPromptDialog: (callback: () => void) => () => void;

  /**
   * Registers a callback for opening history dialog.
   */
  onOpenHistoryDialog: (callback: () => void) => () => void;

  /**
   * Registers a callback for showing the tray window with view and initial tab.
   */
  onTrayOpen: (
    callback: (args: { view: string; initialTab?: number }) => void
  ) => () => void;

  /**
   * Hides the tray window.
   */
  hideTray: () => void;

  /**
   * Retrieves the stored translation target language.
   */
  getTranslationTargetLang: () => Promise<string>;

  /**
   * Sets the stored translation target language.
   */
  setTranslationTargetLang: (
    lang: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * Sends a translation request for the given text to main process.
   */
  translate: (text: string, targetLang: string) => Promise<{ success: boolean; error?: string }>;

  /**
   * Requests summarization of the given text.
   */
  summarize: (
    text: string,
    maxInput: number
  ) => Promise<{ success: boolean; summarizedText: string; promptTokens: number | null; completionTokens: number | null; error?: string }>;

  /**
   * Registers callback for translation results from main process.
   */
  onTranslationResult: (
    callback: (payload: { translatedText: string; promptTokens: number | null; completionTokens: number | null }) => void
  ) => () => void;

  /**
   * Registers callback for translation errors from main process.
   */
  onTranslationError: (callback: (error: string) => void) => () => void;

  /**
   * Registers a callback for raw translation data (for popup window).
   */
  onTranslationData: (
    callback: (payload: { translatedText: string; promptTokens: number | null; completionTokens: number | null; x: number; y: number }) => void
  ) => () => void;

  /**
   * Requests translation window to close.
   */
  closeTranslationWindow: () => void;

  /**
   * Copies given text to clipboard.
   */
  copyToClipboard: (text: string) => Promise<{ success: boolean }>;

  /**
   * Requests application to quit.
   */
  quitApp: () => void;

  // --- Correct feature ---
  getCorrectSettings: () => Promise<{
    tone: string;
    paraphrase: boolean;
  }>;
  setCorrectSettings: (settings: { tone: string; paraphrase: boolean }) => Promise<{ success: boolean }>;
  getCorrectHistory: () => Promise<VersionEntry[]>;
  clearCorrectHistory: () => Promise<{ success: boolean }>;

  // --- Summarize feature ---
  getSummarizeSettings: () => Promise<{ minLength: number; maxLength: number }>;
  setSummarizeSettings: (settings: { minLength: number; maxLength: number }) => Promise<{ success: boolean }>;
  getSummarizeHistory: () => Promise<VersionEntry[]>;
  clearSummarizeHistory: () => Promise<{ success: boolean }>;

  // --- Translate feature settings ---
  getTranslateSettings: () => Promise<{ destinationLang: string; includeExplanation: boolean }>;
  setTranslateSettings: (settings: { destinationLang: string; includeExplanation: boolean }) => Promise<{ success: boolean }>;

  // --- Explain feature ---
  getExplainSettings: () => Promise<{ level: string; includeResources: boolean }>;
  setExplainSettings: (settings: { level: string; includeResources: boolean }) => Promise<{ success: boolean }>;
  getExplainHistory: () => Promise<VersionEntry[]>;
  clearExplainHistory: () => Promise<{ success: boolean }>;

  // --- Expand feature ---
  getExpandSettings: () => Promise<{ minLength: number; maxLength: number }>;
  setExpandSettings: (settings: { minLength: number; maxLength: number }) => Promise<{ success: boolean }>;
  getExpandHistory: () => Promise<VersionEntry[]>;
  clearExpandHistory: () => Promise<{ success: boolean }>;

  // --- Shorten feature ---
  getShortenSettings: () => Promise<{ minLength: number; maxLength: number }>;
  setShortenSettings: (settings: { minLength: number; maxLength: number }) => Promise<{ success: boolean }>;
  getShortenHistory: () => Promise<VersionEntry[]>;
  clearShortenHistory: () => Promise<{ success: boolean }>;

  // --- PromptGen feature ---
  getPromptgenSettings: () => Promise<{ minLength: number; maxLength: number; nsfw: boolean }>;
  setPromptgenSettings: (settings: { minLength: number; maxLength: number; nsfw: boolean }) => Promise<{ success: boolean }>;
  getPromptgenHistory: () => Promise<VersionEntry[]>;
  clearPromptgenHistory: () => Promise<{ success: boolean }>;
};
