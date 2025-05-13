/**
 * @file store.ts
 * @description Electron Store schema, types, and initialization for settings and key bindings.
 */
import Store from "electron-store";
import { DEFAULT_OPENAI_MODEL, DEFAULT_LANGUAGE } from "~/const";
import type { Schema } from "electron-store";

export type Model = {
  id: string;
  name: string;
  created: number;
  pricing?: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
    input_cache_read: string;
    input_cache_write: string;
    web_search: string;
    internal_reasoning: string;
  };
  local?: {
    path: string;
    size?: number;
    parameters?: {
      temperature?: number;
      top_p?: number;
      repeat_penalty?: number;
      [key: string]: unknown;
    };
  };
};

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
  top_p: number;
  maxTokens: number;
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
    model: string;
  };
  settingsTranslate: {
    destinationLang: string;
    includeExplanation: boolean;
    model: string;
  };
  settingsSummarize: {
    minLength: number;
    maxLength: number;
    model: string;
    targetLanguage: string;
  };
  settingsPromptGen: {
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
    model: string;
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
      temperature: { type: "number", default: 1 },
      top_p: { type: "number", default: 1.0 },
      maxTokens: { type: "number", default: 10000 },
    },
    default: {
      customSystemPrompt: "",
      customUserPrompt: "",
      tone: "",
      temperature: 1,
      top_p: 1.0,
      maxTokens: 10000,
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
      model: { type: "string", default: "" },
    },
    default: {
      paraphrase: false,
      withShorten: false,
      paraphrasePrompt: "",
      userInput: "",
      model: DEFAULT_OPENAI_MODEL,
    },
  },
  settingsSummarize: {
    type: "object",
    properties: {
      minLength: { type: "number", default: 0 },
      maxLength: { type: "number", default: 0 },
      model: { type: "string", default: DEFAULT_OPENAI_MODEL },
      targetLanguage: { type: "string", default: DEFAULT_LANGUAGE },
    },
    default: {
      minLength: 0,
      maxLength: 0,
      model: DEFAULT_OPENAI_MODEL,
      targetLanguage: DEFAULT_LANGUAGE,
    },
  },
  settingsTranslate: {
    type: "object",
    properties: {
      destinationLang: { type: "string", default: "" },
      includeExplanation: { type: "boolean", default: false },
      model: { type: "string", default: "" },
    },
    default: {
      destinationLang: "",
      includeExplanation: false,
      model: DEFAULT_OPENAI_MODEL,
    },
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
      model: { type: "string", default: "" },
    },
    default: {
      minLength: 50,
      maxLength: 150,
      batchCount: 5,
      nsfw: true,
      context: "",
      autoCopy: false,
      model: DEFAULT_OPENAI_MODEL,
    },
  },
} satisfies Schema<SettingsStore>;

export const apiStore = new Store<SettingsStore>({
  schema,
  encryptionKey: "fixlang-secure-encryption-key",
  clearInvalidConfig: true,
  watch: true,
});

export const getOpenAIKey = () => {
  const apiKey = apiStore.get("apiKey");
  if (!apiKey) {
    throw new Error("OpenAI API Key not set in settings.");
  }
  return apiKey;
};
