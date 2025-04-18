/**
 * @file store.ts
 * @description Electron Store schema, types, and initialization for settings and key bindings.
 */
import Store from "electron-store";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import type { Schema } from "electron-store";
import type { Model } from "openai/resources.mjs";

export type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
  translate: string; // keyboard shortcut for translation
};

// New type for version entries
export type VersionEntry = {
  original: string;
  corrected: string;
  timestamp: string;
};

export type SettingsStore = {
  apiKey: string;
  models: Model[];
  selectedModel: string;
  temperature: number;
  customSystemPrompt: string;
  customUserPrompt: string;
  withGrammar: boolean;
  withShorten: boolean;
  tone: string;
  history: VersionEntry[];  // persistent correction history
  translationTargetLang: string; // persistent translation target language
};

const schema = {
  apiKey: {
    type: "string",
    default: process.env.OPENAI_API_KEY,
  },
  selectedModel: { type: "string", default: DEFAULT_OPENAI_MODEL },
  models: {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        object: { type: "string" },
        created: { type: "number" },
        owned_by: { type: "string" },
      },
      required: ["id"],
    },
    default: [],
  },
  customSystemPrompt: { type: "string", default: "" },
  customUserPrompt: { type: "string", default: "" },
  withGrammar: { type: "boolean", default: true },
  withShorten: { type: "boolean", default: false },
  tone: { type: "string", default: "" },
  temperature: { type: "number", default: 0.3 },
  history: { type: "array", default: [] },
  translationTargetLang: { type: "string", default: "" },
} satisfies Schema<SettingsStore>;

export const store = new Store<SettingsStore>({
  schema,
  encryptionKey: "fixlang-secure-encryption-key",
  clearInvalidConfig: true,
  watch: true,
});
