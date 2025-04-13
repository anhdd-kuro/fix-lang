/// <reference types="electron-vite/node" />
/// <reference types="node" />

type TextUpdatePayload = {
  original: string;
  fixed: string;
};

type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
};

interface ElectronAPI {
  onUpdateText: (callback: (payload: TextUpdatePayload) => void) => () => void;
  getApiKey: () => Promise<string>;
  setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  getKeyBindings: () => Promise<KeyBindings>;
  setKeyBindings: (bindings: KeyBindings) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
