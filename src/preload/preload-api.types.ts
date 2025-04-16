/**
 * Shared type definition for all APIs exposed by Electron preload script.
 * Import this type in both preload and global electron.d.ts for DRY and type-safe IPC.
 */

export type TextUpdatePayload = {
  original: string;
  fixed: string;
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
  fetchOpenAIModels: () => Promise<{
    success: boolean;
    models?: {
      id: string;
      object: string;
      created: number;
      owned_by: string;
    }[];
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
};
