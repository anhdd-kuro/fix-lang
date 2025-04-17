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
};
