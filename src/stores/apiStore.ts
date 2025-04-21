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
  summarize: string; // condense selected text into a brief summary
  paraphrase: string; // restate in different words
  explain: string; // give a clearer, step-by-step explanation
  promptGen: string; // generate a new prompt based on current selection
};

// New type for version entries
export type VersionEntry = {
  original: string;
  corrected: string;
  timestamp: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
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
  history: VersionEntry[]; // persistent correction history
  translationTargetLang: string; // persistent translation target language
  translations: VersionEntry[]; // persistent translation history entries
  historySummarize: VersionEntry[];
  historyExplain: VersionEntry[];
  historyPromptGen: VersionEntry[];
  settingsCorrect: { tone: string; paraphrase: boolean };
  settingsSummarize: { minLength: number; maxLength: number };
  settingsTranslate: { destinationLang: string; includeExplanation: boolean };
  settingsExplain: { level: "Expert" | "Professional" | "Casual" | "Beginner" | "Child"; includeResources: boolean };
  settingsPromptGen: { minLength: number; maxLength: number; nsfw: boolean };
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
  translations: {
    type: "array",
    items: {
      type: "object",
      properties: {
        original: { type: "string" },
        corrected: { type: "string" },
        timestamp: { type: "string" },
        promptTokens: { type: ["number", "null"] },
        completionTokens: { type: ["number", "null"] },
      },
      required: ["original", "corrected", "timestamp"],
    },
    default: [],
  },
  historySummarize: { type: "array", default: [] },
  historyExplain: { type: "array", default: [] },
  historyPromptGen: { type: "array", default: [] },
  settingsCorrect: {
    type: "object",
    properties: {
      tone: { type: "string", default: "" },
      paraphrase: { type: "boolean", default: false },
    },
    default: { tone: "", paraphrase: false },
  },
  settingsSummarize: {
    type: "object",
    properties: {
      minLength: { type: "number", default: 0 },
      maxLength: { type: "number", default: 0 },
    },
    default: { minLength: 0, maxLength: 0 },
  },
  settingsTranslate: {
    type: "object",
    properties: {
      destinationLang: { type: "string", default: "" },
      includeExplanation: { type: "boolean", default: false },
    },
    default: { destinationLang: "", includeExplanation: false },
  },
  settingsExplain: {
    type: "object",
    properties: {
      level: { type: "string", default: "Beginner" },
      includeResources: { type: "boolean", default: false },
    },
    default: { level: "Beginner", includeResources: false },
  },
  settingsPromptGen: {
    type: "object",
    properties: {
      minLength: { type: "number", default: 0 },
      maxLength: { type: "number", default: 0 },
      nsfw: { type: "boolean", default: false },
    },
    default: { minLength: 0, maxLength: 0, nsfw: false },
  },
} satisfies Schema<SettingsStore>;

export const store = new Store<SettingsStore>({
  schema,
  encryptionKey: "fixlang-secure-encryption-key",
  clearInvalidConfig: true,
  watch: true,
});
