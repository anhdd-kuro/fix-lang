/**
 * @file store.ts
 * @description Electron Store schema, types, and initialization for settings and key bindings.
 */
import Store from "electron-store";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import type { Schema } from "electron-store";
import type { Model } from "openai/resources.mjs";

export type KeyBindings = {
  correction: string;
  translate: string; // keyboard shortcut for translation
  summarize: string; // condense selected text into a brief summary
  promptGen: string; // generate a new prompt based on current selection
};

export type GlobalSettings = {
  customSystemPrompt: string;
  customUserPrompt: string;
  tone: string;
  temperature: number;
};

export type SettingsStore = {
  // Core API settings
  apiKey: string;
  models: Model[];
  selectedModel: string;

  // Global settings that apply across features
  globalSettings: GlobalSettings;

  // Feature-specific settings
  settingsCorrect: {
    paraphrase: boolean;
    withShorten: boolean;
    paraphrasePrompt: string;
    userInput: string;
  };
  settingsTranslate: {
    destinationLang: string;
    includeExplanation: boolean;
  };
  settingsSummarize: {
    minLength: number;
    maxLength: number;
  };
  settingsPromptGen: {
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
  };

  // Legacy fields (for backward compatibility)
  customSystemPrompt: string;
  customUserPrompt: string;
  tone: string;
  translationTargetLang: string; // deprecated, use settingsTranslate.destinationLang
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
  globalSettings: {
    type: "object",
    properties: {
      customSystemPrompt: { type: "string", default: "" },
      customUserPrompt: { type: "string", default: "" },
      tone: { type: "string", default: "" },
      temperature: { type: "number", default: 0.3 },
    },
    default: {
      customSystemPrompt: "",
      customUserPrompt: "",
      tone: "",
      temperature: 0.3,
    },
  },
  // Legacy fields (for backward compatibility)
  customSystemPrompt: { type: "string", default: "" },
  customUserPrompt: { type: "string", default: "" },
  tone: { type: "string", default: "" },
  // temperature moved to globalSettings
  translationTargetLang: { type: "string", default: "" },
  settingsCorrect: {
    type: "object",
    properties: {
      paraphrase: { type: "boolean", default: false },
      withShorten: { type: "boolean", default: false },
      paraphrasePrompt: { type: "string", default: "" },
      userInput: { type: "string", default: "" },
    },
    default: {
      paraphrase: false,
      withShorten: false,
      paraphrasePrompt: "",
      userInput: "",
    },
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
  settingsPromptGen: {
    type: "object",
    properties: {
      minLength: { type: "number", default: 50 },
      maxLength: { type: "number", default: 150 },
      batchCount: { type: "number", default: 5 },
      nsfw: { type: "boolean", default: true },
      context: { type: "string", default: "" },
      autoCopy: { type: "boolean", default: false },
    },
    default: {
      minLength: 50,
      maxLength: 150,
      batchCount: 5,
      nsfw: true,
      context: "",
      autoCopy: false,
    },
  },
} satisfies Schema<SettingsStore>;

export const store = new Store<SettingsStore>({
  schema,
  encryptionKey: "fixlang-secure-encryption-key",
  clearInvalidConfig: true,
  watch: true,
});

export const getOpenAIKey = () => {
  const apiKey = store.get("apiKey");
  if (!apiKey) {
    throw new Error("OpenAI API Key not set in settings.");
  }
  return apiKey;
};
