/**
 * @file store.ts
 * @description Electron Store schema, types, and initialization for settings and key bindings.
 */
import Store from "electron-store";

export type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
};

export type SettingsStore = {
  apiKey: string;
  keyBindings: KeyBindings;
};

const schema = {
  apiKey: {
    type: "string",
    default: process.env.OPENAI_API_KEY,
  },
  keyBindings: {
    type: "object",
    properties: {
      fix: { type: "string", default: "Control+Shift+F" },
      undo: { type: "string", default: "Control+Shift+Z" },
      retry: { type: "string", default: "Control+Shift+A" },
    },
    default: {
      fix: "Control+Shift+F",
      undo: "Control+Shift+Z",
      retry: "Control+Shift+A",
    },
  },
};

export const store = new Store<SettingsStore>({
  schema,
  encryptionKey: "fixlang-secure-encryption-key",
  clearInvalidConfig: true,
  watch: true,
});
