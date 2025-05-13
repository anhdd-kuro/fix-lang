/**
 * @file store.ts
 * @description Electron Store schema, types, and initialization for settings and key bindings.
 */
import Store from "electron-store";
import { DEFAULT_LANGUAGE, DEFAULT_OPENAI_MODEL } from "~/const";
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
  profileSwitch: string; // switch to next profile in rotation
};

export type GlobalSettings = {
  customSystemPrompt: string;
  customUserPrompt: string;
  tone: string;
  temperature: number;
  top_p: number;
  maxTokens: number;
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

  // Profiles
  profiles: Profile[];
  currentProfileId: string;

  // Legacy fields (for backward compatibility)
  customSystemPrompt: string;
  customUserPrompt: string;
  tone: string;
  translationTargetLang: string; // deprecated, use settingsTranslate.destinationLang
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
  description = ""
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
 * Gets a specific setting from the current profile
 * @param settingType The type of setting to retrieve
 * @returns The requested setting from the current profile
 */
export const getProfileSetting = <K extends keyof SettingsStore>(
  settingType: K
): SettingsStore[K] => {
  const settings = getCurrentProfileSettings();
  return settings[settingType];
};

/**
 * Applies settings from a profile
 * @param profileId Profile ID to apply
 * @returns Success status and error message if applicable
 */
export const applyProfile = (
  profileId: string
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
  value: SettingsStore[K]
): { success: boolean; error?: string } => {
  try {
    const currentProfileId = apiStore.get("currentProfileId", "");

    // If no active profile, create a new default profile
    if (!currentProfileId) {
      const newProfile = createProfile();
      apiStore.set("currentProfileId", newProfile.id);

      // Update the newly created profile
      return updateProfileSetting(settingType, value);
    }

    const profiles = getProfiles();
    const profileIndex = profiles.findIndex((p) => p.id === currentProfileId);

    // If profile not found, create a new one
    if (profileIndex === -1) {
      const newProfile = createProfile();
      apiStore.set("currentProfileId", newProfile.id);

      // Update the newly created profile
      return updateProfileSetting(settingType, value);
    }

    // Create updated profile with the new setting
    const updatedProfile = {
      ...profiles[profileIndex],
      updatedAt: new Date().toISOString(),
      settings: {
        ...profiles[profileIndex].settings,
        [settingType]: value,
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
  description?: string
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
      filteredProfiles.length > 0 ? filteredProfiles[0].id : ""
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
