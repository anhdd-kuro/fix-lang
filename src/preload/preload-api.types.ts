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
   * Retrieves the history of corrections (up to 20 entries).
   */
  getHistory: () => Promise<VersionEntry[]>;

  /**
   * Clears all saved correction history.
   */
  clearHistory: () => Promise<{ success: boolean; error?: string }>;

  /**
   * Retrieves the last correction entry.
   */
  getLastHistory: () => Promise<{
    original: string;
    corrected: string;
  }>;

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
};
