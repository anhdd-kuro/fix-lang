/**
 * @file store.ts
 * @description Electron Store schema, types, and initialization for settings and key bindings.
 */
import Store from "electron-store";
import { DEFAULT_LANGUAGE, DEFAULT_OPENAI_MODEL } from "~/const";
import {
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_CUSTOM_PROMPT,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  DEFAULT_SUMMARIZE_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_PROMPT,
  DEFAULT_TRANSLATE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_PROMPT,
} from "~/prompts";
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
  promptGen: string; // generate a new prompt based on current selection
  profileSwitch: string; // switch to next profile in rotation
};

export type CorrectionPreset = {
  id: string;
  name: string;
  hotkey: string;
  systemPrompt: string;
  model: string;
  isBuiltIn: boolean;
  /** Optional per-preset temperature override; undefined means use the request default (1). */
  temperature?: number;
  /** Optional per-preset maxTokens override; undefined means use the request default (10000). */
  maxTokens?: number;
};

export type CorrectionSettings = {
  presets: CorrectionPreset[];
  selectedPresetId: string;
};

/**
 * Profile to store and switch between different application settings
 */
export type Profile = {
  id: string; // UUID
  name: string;
  description?: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  settings: SettingsStore;
};

export type SettingsStore = {
  // Core API settings
  apiKey: string;
  models: Model[];
  selectedModel: string;

  // Feature-specific settings
  settingsCorrect: CorrectionSettings;
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

  // Profiles
  profiles: Profile[];
  currentProfileId: string;

  // Legacy fields (for backward compatibility)
  customSystemPrompt: string;
  customUserPrompt: string;
  tone: string;
};

type LegacyCorrectionSettings = {
  paraphrase?: boolean;
  withShorten?: boolean;
  paraphrasePrompt?: string;
  userInput?: string;
  model?: string;
};

/**
 * Shape of the retired standalone-Translate feature's settings, carried over
 * when an existing user upgrades to the preset-based model. All fields optional
 * because legacy stores may be partial.
 */
export type LegacyTranslateSettings = {
  destinationLang?: string;
  includeExplanation?: boolean;
  model?: string;
  /** Old keyBindings.translate accelerator, if still present in the store. */
  hotkey?: string;
};

/**
 * Build the system prompt for a migrated Translate preset: the bundled JP↔EN
 * prompt, augmented with the user's legacy target language / explanation
 * preference so their configured behavior is preserved on upgrade.
 */
const buildMigratedTranslatePrompt = (
  legacy: LegacyTranslateSettings,
): string => {
  const base = DEFAULT_TRANSLATE_PRESET_PROMPT.trim();
  const destinationLang = legacy.destinationLang?.trim();
  if (!destinationLang) {
    return base;
  }
  const explanation = legacy.includeExplanation
    ? " Include a brief explanation of the translation."
    : "";
  return `${base}\n\nPreferred target language: ${destinationLang}.${explanation}`;
};

/**
 * Apply retired standalone-Translate settings onto the Translate preset.
 * Only runs when the stored config did NOT already contain a Translate preset
 * (i.e. a genuine pre-preset upgrade) so it never clobbers a user-customized one.
 */
const applyLegacyTranslateMigration = (
  presets: CorrectionPreset[],
  legacy: LegacyTranslateSettings | undefined,
  storedHadTranslatePreset: boolean,
): CorrectionPreset[] => {
  const hasLegacyData =
    !!legacy &&
    (!!legacy.destinationLang?.trim() ||
      !!legacy.model?.trim() ||
      !!legacy.hotkey?.trim() ||
      legacy.includeExplanation === true);

  if (storedHadTranslatePreset || !hasLegacyData || !legacy) {
    return presets;
  }

  return presets.map((preset) =>
    preset.id === DEFAULT_TRANSLATE_PRESET_ID
      ? {
          ...preset,
          model: legacy.model?.trim() || preset.model,
          hotkey: legacy.hotkey?.trim() || preset.hotkey,
          systemPrompt: buildMigratedTranslatePrompt(legacy),
        }
      : preset,
  );
};

const makeDefaultCorrectionPresets = (): CorrectionPreset[] => [
  {
    id: DEFAULT_CORRECTION_PRESET_ID,
    name: "Correction",
    hotkey: "Control+Shift+F",
    systemPrompt: DEFAULT_CUSTOM_PROMPT.trim(),
    model: DEFAULT_OPENAI_MODEL,
    isBuiltIn: true,
  },
  {
    id: DEFAULT_SUMMARIZE_PRESET_ID,
    name: "Summarize",
    hotkey: "Control+Shift+S",
    systemPrompt: DEFAULT_SUMMARIZE_PRESET_PROMPT,
    model: DEFAULT_OPENAI_MODEL,
    isBuiltIn: true,
  },
  {
    id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
    name: "Prompt optimization",
    hotkey: "Control+Shift+D",
    systemPrompt: DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
    model: DEFAULT_OPENAI_MODEL,
    isBuiltIn: true,
  },
  {
    id: DEFAULT_TRANSLATE_PRESET_ID,
    name: "Translate",
    hotkey: "Control+Shift+T",
    systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT.trim(),
    model: DEFAULT_OPENAI_MODEL,
    isBuiltIn: true,
  },
];

export const getDefaultCorrectionSettings = (): CorrectionSettings => ({
  presets: makeDefaultCorrectionPresets(),
  selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
});

const buildLegacyCorrectionPrompt = (
  legacy: LegacyCorrectionSettings,
): string => {
  const sections = [legacy.userInput?.trim() || DEFAULT_CUSTOM_PROMPT.trim()];

  if (legacy.paraphrasePrompt?.trim()) {
    sections.push(legacy.paraphrasePrompt.trim());
  }

  return sections.join("\n\n");
};

export const normalizeCorrectionSettings = (
  value: unknown,
  legacyTranslate?: LegacyTranslateSettings,
): CorrectionSettings => {
  const defaults = getDefaultCorrectionSettings();
  const defaultById = new Map(
    defaults.presets.map((preset) => [preset.id, preset]),
  );

  if (!value || typeof value !== "object") {
    return {
      ...defaults,
      presets: applyLegacyTranslateMigration(
        defaults.presets,
        legacyTranslate,
        false,
      ),
    };
  }

  const raw = value as Partial<CorrectionSettings> & LegacyCorrectionSettings;

  const storedHadTranslatePreset =
    Array.isArray(raw.presets) &&
    raw.presets.some(
      (preset) =>
        !!preset &&
        typeof preset === "object" &&
        (preset as Partial<CorrectionPreset>).id === DEFAULT_TRANSLATE_PRESET_ID,
    );

  const getTrimmedString = (candidate: unknown): string | undefined => {
    return typeof candidate === "string" ? candidate.trim() : undefined;
  };

  if (!Array.isArray(raw.presets)) {
    const migratedCorrectionPreset = {
      ...defaults.presets[0],
      systemPrompt: buildLegacyCorrectionPrompt(raw),
      model: raw.model?.trim() || defaults.presets[0].model,
    } satisfies CorrectionPreset;

    // Return all built-in defaults; only the correction preset gets the migrated prompt.
    // Using slice(1) ensures summarize, prompt-optimization, and translate are all included.
    return {
      presets: applyLegacyTranslateMigration(
        [migratedCorrectionPreset, ...defaults.presets.slice(1)],
        legacyTranslate,
        false,
      ),
      selectedPresetId: migratedCorrectionPreset.id,
    };
  }

  const seenIds = new Set<string>();
  const normalizedPresets = raw.presets.flatMap((preset, index) => {
    if (!preset || typeof preset !== "object") {
      return [];
    }

    const candidate = preset as Partial<CorrectionPreset>;
    const fallback = defaultById.get(candidate.id?.trim() || "");
    const id = candidate.id?.trim() || `preset-${index + 1}`;

    if (seenIds.has(id)) {
      return [];
    }

    seenIds.add(id);

    // Extract optional numeric fields — non-numeric values are silently dropped
    const rawCandidate = candidate as Record<string, unknown>;
    const temperature =
      typeof rawCandidate.temperature === "number"
        ? rawCandidate.temperature
        : undefined;
    const maxTokens =
      typeof rawCandidate.maxTokens === "number"
        ? rawCandidate.maxTokens
        : undefined;

    return [
      {
        id,
        name: candidate.name?.trim() || fallback?.name || `Preset ${index + 1}`,
        hotkey: getTrimmedString(candidate.hotkey) ?? fallback?.hotkey ?? "",
        systemPrompt:
          candidate.systemPrompt?.trim() ||
          fallback?.systemPrompt ||
          DEFAULT_CUSTOM_PROMPT.trim(),
        model:
          candidate.model?.trim() || fallback?.model || DEFAULT_OPENAI_MODEL,
        isBuiltIn: fallback ? true : Boolean(candidate.isBuiltIn),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
      } satisfies CorrectionPreset,
    ];
  });

  const presets = [
    ...defaults.presets.map(
      (defaultPreset) =>
        normalizedPresets.find((preset) => preset.id === defaultPreset.id) ||
        defaultPreset,
    ),
    ...normalizedPresets.filter((preset) => !defaultById.has(preset.id)),
  ];

  const migratedPresets = applyLegacyTranslateMigration(
    presets,
    legacyTranslate,
    storedHadTranslatePreset,
  );

  const selectedPresetId =
    typeof raw.selectedPresetId === "string" &&
    migratedPresets.some((preset) => preset.id === raw.selectedPresetId)
      ? raw.selectedPresetId
      : migratedPresets[0]?.id || DEFAULT_CORRECTION_PRESET_ID;

  return {
    presets: migratedPresets,
    selectedPresetId,
  };
};

const schema = {
  currentProfileId: { type: "string", default: "" },
  profiles: {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        settings: {
          type: "object",
          properties: {
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
            tone: { type: "string", default: "" },
            settingsCorrect: {
              type: "object",
              properties: {
                selectedPresetId: {
                  type: "string",
                  default: DEFAULT_CORRECTION_PRESET_ID,
                },
                presets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      hotkey: { type: "string" },
                      systemPrompt: { type: "string" },
                      model: { type: "string" },
                      isBuiltIn: { type: "boolean" },
                      temperature: { type: "number" },
                      maxTokens: { type: "number" },
                    },
                    required: ["id", "name", "hotkey", "systemPrompt", "model"],
                  },
                  default: makeDefaultCorrectionPresets(),
                },
              },
              default: getDefaultCorrectionSettings(),
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
          },
        },
      },
      required: ["id", "name", "createdAt", "settings"],
    },
    default: [],
  },
} satisfies Schema<{ profiles: Profile[]; currentProfileId: string }>;

export const apiStore = new Store<{ profiles: Profile[] }>({
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

/**
 * Creates a profile from current settings
 * @param name Profile name
 * @param description Optional profile description
 * @returns The created profile
 */
export const createProfile = (
  name = "Default Profile",
  description = "",
): Profile => {
  const now = new Date().toISOString();

  // Get current settings or create default settings if not available
  let profileSettings = apiStore.get("settings") as SettingsStore;
  if (!profileSettings) {
    profileSettings = {} as SettingsStore;
  }

  const profile = {
    id: `profile_${Date.now()}`,
    name,
    description,
    createdAt: now,
    updatedAt: now,
    settings: profileSettings,
  } satisfies Profile;

  // Add to profiles array
  const profiles = apiStore.get("profiles", []) as Profile[];
  profiles.push(profile);
  apiStore.set("profiles", profiles);

  // Set as current profile
  apiStore.set("currentProfileId", profile.id);

  return profile;
};

/**
 * Gets all saved profiles
 * @returns Array of saved profiles
 */
export const getProfiles = (): Profile[] => {
  return apiStore.get("profiles", []) as Profile[];
};

/**
 * Gets current profile ID
 * @returns Current profile ID or empty string if none
 */
export const getCurrentProfileId = (): string => {
  return apiStore.get("currentProfileId", "") as string;
};

/**
 * Gets a profile by ID
 * @param profileId Profile ID to get
 * @returns Profile or null if not found
 */
export const getProfileById = (profileId: string): Profile | null => {
  const profiles = getProfiles();
  return profiles.find((profile) => profile.id === profileId) || null;
};

/**
 * Gets all settings from the current profile
 * @returns All settings from the current profile (or creates a default profile if none active)
 */
export const getCurrentProfileSettings = (): SettingsStore => {
  const currentProfileId = apiStore.get("currentProfileId", "");

  // If no current profile, return the default settings object
  if (!currentProfileId) {
    const defaultSettings =
      (apiStore.get("settings") as SettingsStore) || ({} as SettingsStore);
    return defaultSettings;
  }

  const profiles = getProfiles();
  const currentProfile = profiles.find((p) => p.id === currentProfileId);

  // If profile not found, return default settings
  if (!currentProfile) {
    return (apiStore.get("settings") as SettingsStore) || ({} as SettingsStore);
  }

  return currentProfile.settings;
};

/**
 * Pull the retired standalone-Translate settings out of a raw profile settings
 * object. The field was removed from SettingsStore, so it is read defensively
 * via an unknown cast — upgrading users still have it in the persisted JSON.
 */
const extractLegacyTranslateSettings = (
  settings: SettingsStore,
): LegacyTranslateSettings | undefined => {
  const legacy = (settings as { settingsTranslate?: unknown }).settingsTranslate;
  if (!legacy || typeof legacy !== "object") {
    return undefined;
  }
  const t = legacy as Record<string, unknown>;
  return {
    destinationLang:
      typeof t.destinationLang === "string" ? t.destinationLang : undefined,
    includeExplanation:
      typeof t.includeExplanation === "boolean"
        ? t.includeExplanation
        : undefined,
    model: typeof t.model === "string" ? t.model : undefined,
  };
};

/**
 * Gets a specific setting from the current profile
 * @param settingType The type of setting to retrieve
 * @returns The requested setting from the current profile
 */
export const getProfileSetting = <K extends keyof SettingsStore>(
  settingType: K,
): SettingsStore[K] => {
  const settings = getCurrentProfileSettings();

  if (settingType === "settingsCorrect") {
    return normalizeCorrectionSettings(
      settings[settingType],
      // Carry over the retired standalone-Translate settings (still present in
      // the raw store for upgrading users; no longer on the SettingsStore type).
      extractLegacyTranslateSettings(settings),
    ) as SettingsStore[K];
  }

  return settings[settingType];
};

/**
 * Applies settings from a profile
 * @param profileId Profile ID to apply
 * @returns Success status and error message if applicable
 */
export const applyProfile = (
  profileId: string,
): { success: boolean; error?: string } => {
  try {
    const profile = getProfileById(profileId);
    if (!profile) {
      return { success: false, error: "Profile not found" };
    }

    // Set as current profile - we no longer copy settings to the global level
    apiStore.set("currentProfileId", profileId);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error applying profile",
    };
  }
};

/**
 * Updates a specific setting in the current profile
 * @param settingType The type of setting to update
 * @param value The new value for the setting
 * @returns Success status and error message if applicable
 */
export const updateProfileSetting = <K extends keyof SettingsStore>(
  settingType: K,
  value: SettingsStore[K],
): { success: boolean; error?: string } => {
  try {
    const normalizedValue =
      settingType === "settingsCorrect"
        ? (normalizeCorrectionSettings(value) as SettingsStore[K])
        : value;

    const currentProfileId = apiStore.get("currentProfileId", "");

    // If no active profile, create a new default profile
    if (!currentProfileId) {
      const newProfile = createProfile();
      apiStore.set("currentProfileId", newProfile.id);

      // Update the newly created profile
      return updateProfileSetting(settingType, normalizedValue);
    }

    const profiles = getProfiles();
    const profileIndex = profiles.findIndex((p) => p.id === currentProfileId);

    // If profile not found, create a new one
    if (profileIndex === -1) {
      const newProfile = createProfile();
      apiStore.set("currentProfileId", newProfile.id);

      // Update the newly created profile
      return updateProfileSetting(settingType, normalizedValue);
    }

    // Create updated profile with the new setting
    const updatedProfile = {
      ...profiles[profileIndex],
      updatedAt: new Date().toISOString(),
      settings: {
        ...profiles[profileIndex].settings,
        [settingType]: normalizedValue,
      },
    };

    // Update the profile in the profiles array
    profiles[profileIndex] = updatedProfile;
    apiStore.set("profiles", profiles);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error updating profile setting",
    };
  }
};

/**
 * Updates a profile with current settings
 * @param profileId Profile ID to update
 * @param name Optional new name
 * @param description Optional new description
 * @returns Updated profile or null if not found
 */
export const updateProfile = (
  profileId: string,
  name?: string,
  description?: string,
): Profile | null => {
  const profiles = getProfiles();
  const profileIndex = profiles.findIndex((p) => p.id === profileId);

  if (profileIndex === -1) {
    return null;
  }

  const updatedProfile = {
    ...profiles[profileIndex],
    name: name || profiles[profileIndex].name,
    description:
      description !== undefined
        ? description
        : profiles[profileIndex].description,
    updatedAt: new Date().toISOString(),
  } satisfies Profile;

  profiles[profileIndex] = updatedProfile;
  apiStore.set("profiles", profiles);

  return updatedProfile;
};

/**
 * Deletes a profile
 * @param profileId Profile ID to delete
 * @returns Success status
 */
export const deleteProfile = (profileId: string): boolean => {
  const profiles = getProfiles();
  const filteredProfiles = profiles.filter((p) => p.id !== profileId);

  if (filteredProfiles.length === profiles.length) {
    return false; // No profile found to delete
  }

  apiStore.set("profiles", filteredProfiles);

  // If deleted the current profile, reset current profile ID
  if (getCurrentProfileId() === profileId) {
    apiStore.set(
      "currentProfileId",
      filteredProfiles.length > 0 ? filteredProfiles[0].id : "",
    );
  }

  return true;
};

/**
 * Switch to the next profile in the list (for Ctrl+Shift+P shortcut)
 * @returns The newly selected profile or null if no profiles
 */
export const switchToNextProfile = (): Profile | null => {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    return null;
  }

  const currentProfileId = getCurrentProfileId();
  const currentIndex = profiles.findIndex((p) => p.id === currentProfileId);

  // Get next profile index (loop back to 0 if at end)
  const nextIndex =
    currentIndex === -1 || currentIndex === profiles.length - 1
      ? 0
      : currentIndex + 1;

  const nextProfile = profiles[nextIndex];
  applyProfile(nextProfile.id);

  return nextProfile;
};

/**
 * Initializes a default profile if none exists
 * This should be called when the application starts
 */
export const initializeDefaultProfile = (): void => {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    console.log("Creating default profile");
    createProfile("Default Profile", "Default application settings");
  } else if (!getCurrentProfileId()) {
    // If we have profiles but no current selected, select the first one
    apiStore.set("currentProfileId", profiles[0].id);
  }
};
