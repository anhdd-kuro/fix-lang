/**
 * @file apiStore.test.ts
 * @description Tests for provider-aware model caching and the provider
 * connect/disconnect paths. Pure unit tests — no Electron, no IPC, no
 * network; electron-store is replaced with a stateful in-memory mock so
 * get/set round-trip within a test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// Stateful mock of electron-store: get/set operate over an in-memory object
// so seeded profiles/currentProfileId are readable by the real apiStore.ts
// helpers, and writes made by those helpers are observable by assertions.
vi.mock("electron-store", () => {
  class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string, defaultValue?: unknown) {
      return key in this.data ? this.data[key] : defaultValue;
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
    delete(key: string) {
      Reflect.deleteProperty(this.data, key);
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});
// Mock electron to avoid Notification / ipcMain access in tests.
vi.mock("electron", () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));
// Imports (after mocks) — the real implementation under test.
import { resolveDefaultModel, resolveDefaultOpenAIModel } from "~/const";
import {
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
} from "~/prompts/correction";
import { modelRefForModel } from "~/shared/modelRef";
import {
  isModelForProvider as sharedIsModelForProvider,
  isProviderId as sharedIsProviderId,
  PROVIDER_IDS as sharedProviderIds,
} from "~/shared/providers";
import {
  apiStore,
  apiStoreSchema,
  connectProviderToActiveProfile,
  connectProviderToProfile,
  createProfile,
  disconnectProviderFromActiveProfile,
  disconnectProviderFromProfile,
  getDefaultCorrectionSettings,
  getDefaultModelId,
  getProfiles,
  initializeDefaultProfile,
  isModelForProvider,
  isProviderId,
  migrateStoredProfilesForModelRefs,
  PROVIDER_IDS,
  resetCurrentProfileSettings,
  sanitizeImportedProfile,
  toExportableProfile,
  withoutProfileSecrets,
} from "~/stores/apiStore";
import { migrateProfileForModelRefs } from "~/stores/profileMigration";
import type { Model, Profile, SettingsStore } from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildSettings = (overrides: Partial<SettingsStore> = {}): SettingsStore =>
  ({
    apiKey: "",
    models: [],
    selectedModel: "",
    enabledProviders: [],
    providerEndpoints: {},
    customSystemPrompt: "",
    customUserPrompt: "",
    tone: "",
    settingsCorrect: {
      presets: [
        {
          id: "correction",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "custom-model-a",
          isBuiltIn: true,
        },
        {
          id: "summarize",
          name: "Summarize",
          hotkey: "Control+Shift+S",
          systemPrompt: "Summarize.",
          model: "custom-model-b",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    },
    settingsSummarize: {
      minLength: 0,
      maxLength: 0,
      model: "",
      targetLanguage: "en",
    },
    settingsPromptGen: {
      minLength: 50,
      maxLength: 150,
      batchCount: 5,
      nsfw: true,
      context: "",
      autoCopy: false,
      model: "custom-model-c",
    },
    ...overrides,
  }) as SettingsStore;

const buildProfile = (overrides: Partial<Profile> = {}): Profile =>
  ({
    id: "profile_1",
    name: "Test Profile",
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
    settings: buildSettings(),
    ...overrides,
  }) as Profile;

const seedProfiles = (profiles: Profile[], currentProfileId: string): void => {
  apiStore.set("profiles", profiles);
  apiStore.set("currentProfileId", currentProfileId);
};

const openRouterModel: Model = {
  id: "anthropic/claude-3.5-sonnet",
  name: "claude",
  created: 1,
  provider: "openrouter",
};
const localModel: Model = {
  id: "llama-70b",
  name: "llama-70b",
  created: 2,
  local: { path: "/models/llama-70b" },
};

// The "byte-identical" assertions are the exact inverse of the replaced
// behaviour, which wiped every preset model on each provider commit.
describe("connectProviderToActiveProfile — adds a provider's slice without touching existing model refs", () => {
  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("returns null when there is no active profile", () => {
    seedProfiles([buildProfile()], "");
    expect(connectProviderToActiveProfile("openai", [])).toBeNull();
  });

  it("returns null when the active profile id does not match any profile", () => {
    seedProfiles([buildProfile({ id: "profile_1" })], "profile_missing");
    expect(connectProviderToActiveProfile("openai", [])).toBeNull();
  });

  it("leaves every preset model and selectedModel byte-identical", () => {
    const profile = buildProfile({
      settings: buildSettings({
        selectedModel: "openrouter::anthropic/claude-3.5-sonnet",
        models: [openRouterModel],
      }),
    });
    seedProfiles([profile], profile.id);
    const before = structuredClone(profile.settings);

    const result = connectProviderToActiveProfile("openai", [
      { id: "gpt-4o", name: "gpt-4o", created: 3 },
    ]);

    expect(result?.settings.selectedModel).toBe(before.selectedModel);
    expect(result?.settings.settingsCorrect).toEqual(before.settingsCorrect);
    expect(result?.settings.settingsPromptGen).toEqual(before.settingsPromptGen);
    expect(result?.settings.settingsSummarize).toEqual(before.settingsSummarize);
  });

  it("adds the new provider's slice while leaving the other provider's slice intact", () => {
    const profile = buildProfile({
      settings: buildSettings({ models: [openRouterModel, localModel] }),
    });
    seedProfiles([profile], profile.id);

    const result = connectProviderToActiveProfile("openai", [
      { id: "gpt-4o", name: "gpt-4o", created: 3 },
    ]);

    expect(result?.settings.models).toContainEqual(openRouterModel);
    expect(result?.settings.models).toContainEqual(localModel);
    expect(result?.settings.models).toContainEqual({
      id: "gpt-4o",
      name: "gpt-4o",
      created: 3,
      provider: "openai",
    });
    expect(result?.settings.models).toHaveLength(3);
  });

  it("adds the provider to enabledProviders", () => {
    const profile = buildProfile({
      settings: buildSettings({ enabledProviders: ["openrouter"] }),
    });
    seedProfiles([profile], profile.id);

    const result = connectProviderToActiveProfile("openai", []);

    expect(result?.settings.enabledProviders).toEqual(["openai", "openrouter"]);
  });

  it("is idempotent — connecting twice gains one entry and replaces, never appends, models", () => {
    const profile = buildProfile();
    seedProfiles([profile], profile.id);
    const models: Model[] = [{ id: "gpt-4o", name: "gpt-4o", created: 3 }];

    connectProviderToActiveProfile("openai", models);
    const result = connectProviderToActiveProfile("openai", models);

    expect(result?.settings.enabledProviders).toEqual(["openai"]);
    expect(result?.settings.models).toHaveLength(1);
  });

  // Kills `model.provider === provider`, which the idempotence test above cannot:
  // its first connect tags every entry, so only a pre-tagging cache tells them apart.
  it("replaces an untagged legacy cache entry on reconnect instead of duplicating it", () => {
    const untagged: Model = { id: "gpt-4o", name: "gpt-4o", created: 1 };
    const profile = buildProfile({
      settings: buildSettings({
        models: [untagged],
        enabledProviders: ["openrouter"],
      }),
    });
    seedProfiles([profile], profile.id);

    const result = connectProviderToActiveProfile("openrouter", [
      { id: "gpt-4o", name: "gpt-4o", created: 9 },
    ]);

    expect(result?.settings.models).toEqual([
      { id: "gpt-4o", name: "gpt-4o", created: 9, provider: "openrouter" },
    ]);
  });

  it("does not mutate the profile it was given", () => {
    const profile = buildProfile({
      settings: buildSettings({ models: [openRouterModel] }),
    });
    seedProfiles([profile], profile.id);
    const snapshot = structuredClone(profile);

    connectProviderToActiveProfile("openai", [
      { id: "gpt-4o", name: "gpt-4o", created: 3 },
    ]);

    expect(profile).toEqual(snapshot);
  });

  it("updates updatedAt", () => {
    const profile = buildProfile({ updatedAt: "2000-01-01T00:00:00.000Z" });
    seedProfiles([profile], profile.id);

    const result = connectProviderToActiveProfile("openai", []);

    expect(result?.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });
});

describe("disconnectProviderFromActiveProfile — clears only that provider's refs and reports what it cleared", () => {
  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  const seedConnected = (): Profile => {
    const profile = buildProfile({
      settings: buildSettings({
        enabledProviders: ["openai", "openrouter"],
        models: [
          { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
          openRouterModel,
        ],
        selectedModel: "openai::gpt-4o",
        settingsCorrect: {
          selectedPresetId: "correction",
          presets: [
            {
              id: "correction",
              name: "Correction",
              hotkey: "Control+Shift+F",
              systemPrompt: "Fix grammar.",
              model: "openai::gpt-4o",
              isBuiltIn: true,
            },
            {
              id: "summarize",
              name: "Summarize",
              hotkey: "Control+Shift+S",
              systemPrompt: "Summarize.",
              model: "openrouter::anthropic/claude-3.5-sonnet",
              isBuiltIn: true,
            },
            {
              id: "legacy",
              name: "Legacy",
              hotkey: "",
              systemPrompt: "Legacy.",
              // A bare, un-migrated id: not proven to belong to OpenAI.
              model: "gpt-4o",
              isBuiltIn: false,
            },
          ],
        },
        settingsPromptGen: {
          minLength: 50,
          maxLength: 150,
          batchCount: 5,
          nsfw: true,
          context: "",
          autoCopy: false,
          model: "openai::gpt-4o",
        },
        settingsSummarize: {
          minLength: 0,
          maxLength: 0,
          model: "openrouter::anthropic/claude-3.5-sonnet",
          targetLanguage: "en",
        },
      }),
    });
    seedProfiles([profile], profile.id);
    return profile;
  };

  it("returns null when there is no active profile", () => {
    seedProfiles([buildProfile()], "");
    expect(disconnectProviderFromActiveProfile("openai")).toBeNull();
  });

  it("clears only refs naming the disconnected provider and leaves bare refs untouched", () => {
    seedConnected();

    const result = disconnectProviderFromActiveProfile("openai");
    const presets = result?.profile.settings.settingsCorrect.presets ?? [];

    expect(result?.profile.settings.selectedModel).toBe("");
    expect(presets.find((p) => p.id === "correction")?.model).toBe("");
    // Another provider's ref survives…
    expect(presets.find((p) => p.id === "summarize")?.model).toBe(
      "openrouter::anthropic/claude-3.5-sonnet",
    );
    // …and so does a bare legacy id, which names no provider to match on.
    expect(presets.find((p) => p.id === "legacy")?.model).toBe("gpt-4o");
    expect(result?.profile.settings.settingsPromptGen.model).toBe("");
    expect(result?.profile.settings.settingsSummarize.model).toBe(
      "openrouter::anthropic/claude-3.5-sonnet",
    );
  });

  it("drops the enabledProviders entry and only that provider's model slice", () => {
    seedConnected();

    const result = disconnectProviderFromActiveProfile("openai");

    expect(result?.profile.settings.enabledProviders).toEqual(["openrouter"]);
    expect(result?.profile.settings.models).toEqual([openRouterModel]);
  });

  it("returns a cleared record naming exactly what it reset", () => {
    seedConnected();

    const result = disconnectProviderFromActiveProfile("openai");

    expect(result?.cleared).toEqual({
      selectedModel: true,
      presetIds: ["correction"],
      features: ["promptGen"],
    });
  });

  it("reports a cleared summarize feature model when it named the provider", () => {
    seedConnected();

    const result = disconnectProviderFromActiveProfile("openrouter");

    expect(result?.cleared.features).toEqual(["summarize"]);
    expect(result?.cleared.presetIds).toEqual(["summarize"]);
    expect(result?.cleared.selectedModel).toBe(false);
  });

  it("is a no-op returning an empty cleared when the provider is not connected", () => {
    const profile = seedConnected();
    const setSpy = vi.spyOn(apiStore, "set");

    const result = disconnectProviderFromActiveProfile("ollama");

    expect(result?.cleared).toEqual({
      selectedModel: false,
      presetIds: [],
      features: [],
    });
    expect(result?.profile.settings.selectedModel).toBe("openai::gpt-4o");
    expect(setSpy).not.toHaveBeenCalled();
    expect(getProfiles()[0]).toEqual(profile);
    setSpy.mockRestore();
  });

  it("does not mutate the profile it was given", () => {
    const profile = seedConnected();
    const snapshot = structuredClone(profile);

    disconnectProviderFromActiveProfile("openai");

    expect(profile).toEqual(snapshot);
  });

  // Card 03 concern: disconnect deliberately bypasses normalizeCorrectionSettings
  // (see its doc comment), so adding two new built-in defaults must not make it
  // start materializing them for a profile that never had them stored.
  it("materializes neither new built-in preset — a stored profile lacking them keeps exactly its own presets", () => {
    seedConnected();

    const result = disconnectProviderFromActiveProfile("openai");
    const ids = result?.profile.settings.settingsCorrect.presets.map((p) => p.id);

    expect(ids).toEqual(["correction", "summarize", "legacy"]);
    expect(ids).not.toContain(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids).not.toContain(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
  });
});

describe("the profile-bound variants write to the id they are handed, not the active one", () => {
  const openAIModel: Model = { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" };

  const seedTwoConnected = (): void => {
    const connected = () =>
      buildSettings({ enabledProviders: ["openai"], models: [openAIModel] });
    seedProfiles(
      [
        buildProfile({ id: "profile_1", settings: connected() }),
        buildProfile({ id: "profile_2", settings: connected() }),
      ],
      // The switched-to profile is active; the write must ignore it.
      "profile_2",
    );
  };

  it("disconnects the named profile and leaves the active one alone", () => {
    seedTwoConnected();

    const result = disconnectProviderFromProfile("profile_1", "openai");

    expect(result?.profile.id).toBe("profile_1");
    expect(getProfiles()[0].settings.enabledProviders).toEqual([]);
    expect(getProfiles()[1].settings.enabledProviders).toEqual(["openai"]);
    expect(getProfiles()[1].settings.models).toEqual([openAIModel]);
  });

  it("clears the OpenAI project id on disconnect, and only for OpenAI", () => {
    seedProfiles(
      [
        buildProfile({
          id: "profile_1",
          settings: buildSettings({
            enabledProviders: ["openai", "openrouter"],
            models: [openAIModel],
            openaiProjectId: "proj_old_org",
          }),
        }),
      ],
      "profile_1",
    );

    // The project belongs to the organization the admin key names, so it must not
    // outlive the connection: a key for a different org would keep attributing
    // spend to a project that org has never heard of.
    disconnectProviderFromProfile("profile_1", "openrouter");
    expect(getProfiles()[0].settings.openaiProjectId).toBe("proj_old_org");

    disconnectProviderFromProfile("profile_1", "openai");
    expect(getProfiles()[0].settings.openaiProjectId).toBe("");
  });

  it("writes the OpenAI project id only when the caller supplied one", () => {
    seedTwoConnected();
    // Absent means "leave what is stored"; "" is a deliberate clear.
    connectProviderToProfile("profile_1", "openai", [openAIModel], {
      openaiProjectId: "proj_abc123",
    });
    expect(getProfiles()[0].settings.openaiProjectId).toBe("proj_abc123");

    connectProviderToProfile("profile_1", "openai", [openAIModel]);
    expect(getProfiles()[0].settings.openaiProjectId).toBe("proj_abc123");

    connectProviderToProfile("profile_1", "openai", [openAIModel], {
      openaiProjectId: "",
    });
    expect(getProfiles()[0].settings.openaiProjectId).toBe("");
  });

  it("refuses to store a malformed project id, rather than keeping it", () => {
    seedTwoConnected();
    connectProviderToProfile("profile_1", "openai", [openAIModel], {
      openaiProjectId: "org-not-a-project",
    });
    expect(getProfiles()[0].settings.openaiProjectId).toBe("");
  });

  it("connects the named profile and leaves the active one alone", () => {
    seedTwoConnected();

    const result = connectProviderToProfile("profile_1", "openrouter", [openRouterModel]);

    expect(result?.id).toBe("profile_1");
    expect(result?.settings.enabledProviders).toEqual(["openai", "openrouter"]);
    expect(getProfiles()[1].settings.enabledProviders).toEqual(["openai"]);
  });

  it("returns null for a profile id that no longer exists", () => {
    seedTwoConnected();

    expect(disconnectProviderFromProfile("profile_gone", "openai")).toBeNull();
    expect(connectProviderToProfile("profile_gone", "openai", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isModelForProvider
// ---------------------------------------------------------------------------

describe("isModelForProvider", () => {
  it("matches an openai-tagged model only to openai", () => {
    const model: Model = { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" };
    expect(isModelForProvider(model, "openai")).toBe(true);
    expect(isModelForProvider(model, "openrouter")).toBe(false);
    expect(isModelForProvider(model, "ollama")).toBe(false);
  });

  it("matches an openrouter-tagged model only to openrouter", () => {
    const model: Model = {
      id: "anthropic/claude-3",
      name: "claude-3",
      created: 1,
      provider: "openrouter",
    };
    expect(isModelForProvider(model, "openrouter")).toBe(true);
    expect(isModelForProvider(model, "openai")).toBe(false);
    expect(isModelForProvider(model, "ollama")).toBe(false);
  });

  it("matches a legacy untagged model (no provider, no local) only to openrouter", () => {
    const model: Model = { id: "legacy-model", name: "legacy-model", created: 1 };
    expect(isModelForProvider(model, "openrouter")).toBe(true);
    expect(isModelForProvider(model, "openai")).toBe(false);
    expect(isModelForProvider(model, "ollama")).toBe(false);
  });

  it("matches a model with a local descriptor only to ollama, regardless of provider tag", () => {
    const model: Model = {
      id: "llama-70b",
      name: "llama-70b",
      created: 1,
      local: { path: "/models/llama-70b" },
    };
    expect(isModelForProvider(model, "ollama")).toBe(true);
    expect(isModelForProvider(model, "openrouter")).toBe(false);
    expect(isModelForProvider(model, "openai")).toBe(false);
  });

  it("matches an explicitly ollama-tagged model (no local descriptor) to ollama", () => {
    const model: Model = {
      id: "custom-local",
      name: "custom-local",
      created: 1,
      provider: "ollama",
    };
    expect(isModelForProvider(model, "ollama")).toBe(true);
    expect(isModelForProvider(model, "openrouter")).toBe(false);
    expect(isModelForProvider(model, "openai")).toBe(false);
  });
});

describe("apiStore re-exports from ~/shared/providers", () => {
  it("PROVIDER_IDS, isProviderId and isModelForProvider are the exact ~/shared/providers exports", () => {
    expect(PROVIDER_IDS).toBe(sharedProviderIds);
    expect(isProviderId).toBe(sharedIsProviderId);
    expect(isModelForProvider).toBe(sharedIsModelForProvider);
  });
});

describe("apiStoreSchema — provider removal and enabledProviders", () => {
  const profileSchemaProperties = apiStoreSchema.profiles.items.properties as Record<
    string,
    unknown
  >;
  const settingsSchemaProperties = (
    profileSchemaProperties.settings as {
      properties: Record<string, unknown>;
    }
  ).properties;

  it("the profile schema has no `provider` property", () => {
    expect(profileSchemaProperties).not.toHaveProperty("provider");
  });

  it("enabledProviders is a bare string array with no ajv `enum`, defaulting to []", () => {
    const enabledProviders = settingsSchemaProperties.enabledProviders as Record<
      string,
      unknown
    >;
    expect(enabledProviders).toEqual({
      type: "array",
      items: { type: "string" },
      default: [],
    });
    expect(enabledProviders).not.toHaveProperty("enum");
    expect(
      (enabledProviders.items as Record<string, unknown>),
    ).not.toHaveProperty("enum");
  });

  it("required stays [id, name, createdAt, settings] — no provider requirement", () => {
    expect(apiStoreSchema.profiles.items.required).toEqual([
      "id",
      "name",
      "createdAt",
      "settings",
    ]);
  });
});

describe("apiStoreSchema — model defaults are the inherit sentinel", () => {
  const settingsSchemaProperties = (
    apiStoreSchema.profiles.items.properties.settings as {
      properties: Record<string, { default?: unknown }>;
    }
  ).properties;

  it("selectedModel defaults to \"\"", () => {
    expect(settingsSchemaProperties.selectedModel.default).toBe("");
  });

  it("settingsSummarize.model defaults to \"\" (property and object default)", () => {
    const summarize = settingsSchemaProperties.settingsSummarize as {
      properties: { model: { default?: unknown } };
      default: { model?: unknown };
    };
    expect(summarize.properties.model.default).toBe("");
    expect(summarize.default.model).toBe("");
  });

  it("settingsPromptGen.model defaults to \"\" (property and object default)", () => {
    const promptGen = settingsSchemaProperties.settingsPromptGen as {
      properties: { model: { default?: unknown } };
      default: { model?: unknown };
    };
    expect(promptGen.properties.model.default).toBe("");
    expect(promptGen.default.model).toBe("");
  });

  it("root configVersion defaults to 0", () => {
    expect(apiStoreSchema.configVersion).toEqual({ type: "number", default: 0 });
  });

  it("settings.apiKey defaults to \"\" and never carries a value from the environment", () => {
    expect(settingsSchemaProperties.apiKey.default).toBe("");
  });

  it("no schema default leaks a credential-shaped environment variable", () => {
    const serialised = JSON.stringify(apiStoreSchema);
    const secrets = Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        /KEY|TOKEN|SECRET|PASSWORD/i.test(entry[0]) &&
        typeof entry[1] === "string" &&
        // Short values collide with ordinary schema content ("0", "1", "en").
        entry[1].length >= 8,
    );
    for (const [name, value] of secrets) {
      expect(serialised, `schema embeds the value of ${name}`).not.toContain(value);
    }
  });
});

describe("apiStoreSchema — settingsCorrect default carries all six built-in presets", () => {
  const settingsCorrectSchema = (
    apiStoreSchema.profiles.items.properties.settings as {
      properties: {
        settingsCorrect: {
          properties: { presets: { default?: unknown[] } };
          default: { presets?: unknown[] };
        };
      };
    }
  ).properties.settingsCorrect;

  it("the presets array-item schema default carries 6 presets", () => {
    expect(settingsCorrectSchema.properties.presets.default).toHaveLength(6);
  });

  it("the settingsCorrect object default also carries 6 presets", () => {
    expect(settingsCorrectSchema.default.presets).toHaveLength(6);
  });

  it("both schema default nodes equal getDefaultCorrectionSettings().presets field-for-field", () => {
    const expected = getDefaultCorrectionSettings().presets;
    expect(settingsCorrectSchema.properties.presets.default).toEqual(expected);
    expect(settingsCorrectSchema.default.presets).toEqual(expected);
  });

  it("both new presets are present in the schema default with isBuiltIn true", () => {
    const presets = settingsCorrectSchema.default.presets ?? [];
    expect(
      presets.find((p) => (p as { id: string }).id === DEFAULT_BUSINESS_WRITING_PRESET_ID),
    ).toMatchObject({ isBuiltIn: true, hotkey: "Control+Shift+B" });
    expect(
      presets.find((p) => (p as { id: string }).id === DEFAULT_STRUCTURED_TEXT_PRESET_ID),
    ).toMatchObject({ isBuiltIn: true, hotkey: "Control+Shift+R" });
  });
});

// Do not update this hash to make the test pass. `clearInvalidConfig: true`
// means any change to the schema object can wipe a user's whole config, so a
// changed hash needs the same scrutiny as any other schema edit.
//
// This hash WAS updated for card 03 (adding business-writing/structured-text
// to `makeDefaultCorrectionPresets()`), and again when those two built-in
// prompt markdown assets changed (defaults embed prompt text), when Prompt
// optimization plus Business Writing gained reasoning defaults, and when
// those defaults changed from retired `minimal` to generic `low`,
// after verifying the safety claim below
// rather than taking it on faith:
//
// `apiStore` is built with `clearInvalidConfig: true`, which wipes the ENTIRE
// config only when a STORED value fails schema VALIDATION (type/required/enum
// mismatches) — a `default` is not a validation constraint, it is what ajv's
// `useDefaults` injects when a key is ABSENT. Confirmed by reading the schema:
// neither `settingsCorrect` nor its `presets` array carries `required`,
// `minItems`, or any other constraint that a 4-preset stored array could now
// fail — only the two `default` values (the array-schema default and the
// object-schema default) changed, both only consulted when a profile has no
// stored `settingsCorrect`/`presets` at all. Every existing profile already
// stores `settingsCorrect.presets`, so this edit injects nothing into, and
// invalidates nothing in, an existing user's config. The real-Conf round-trip
// test below (`apiStoreSchema — real schema round trip`) exercises the actual
// validation engine and stayed green, which is the empirical half of this
// check.
describe("apiStoreSchema — serialised schema is byte-identical (regression guard)", () => {
  it("matches the committed sha256 snapshot", async () => {
    const crypto = await import("node:crypto");
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(apiStoreSchema))
      .digest("hex");
    expect(hash).toBe(
      "162007bbc9340783ecb7a395240fad54ce2fa49a252d11032199e8602e1d128b",
    );
  });
});

describe("getDefaultModelId", () => {
  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("returns settings.selectedModel when set", () => {
    const profile = buildProfile({
      settings: buildSettings({ selectedModel: "openai::gpt-4o" }),
    });
    seedProfiles([profile], profile.id);

    expect(getDefaultModelId()).toBe("openai::gpt-4o");
  });

  it("falls back to a ref built from resolveDefaultModel(settings.models) when selectedModel is empty", () => {
    const models: Model[] = [
      { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
      { id: "gpt-4o-mini", name: "gpt-4o-mini", created: 2, provider: "openai" },
    ];
    const profile = buildProfile({
      settings: buildSettings({ selectedModel: "", models }),
    });
    seedProfiles([profile], profile.id);

    expect(getDefaultModelId()).toBe(modelRefForModel(models[1]));
  });

  it("returns \"\" when selectedModel is empty and there are no models", () => {
    const profile = buildProfile({
      settings: buildSettings({ selectedModel: "", models: [] }),
    });
    seedProfiles([profile], profile.id);

    expect(getDefaultModelId()).toBe("");
  });

  it("reads no top-level legacy key — a stray top-level selectedModel/models is ignored", () => {
    const profile = buildProfile({
      settings: buildSettings({ selectedModel: "", models: [] }),
    });
    seedProfiles([profile], profile.id);
    // Legacy, pre-profile top-level keys some old stores may still carry.
    apiStore.set("selectedModel", "legacy-unprefixed-model");
    apiStore.set("models", [
      { id: "legacy-unprefixed-model", name: "legacy", created: 1 },
    ]);

    expect(getDefaultModelId()).toBe("");
  });
});

describe("resetCurrentProfileSettings — preserves apiKey, models and enabledProviders", () => {
  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("preserves enabledProviders across a reset", () => {
    const profile = buildProfile({
      settings: buildSettings({ enabledProviders: ["openai", "ollama"] }),
    });
    seedProfiles([profile], profile.id);

    const result = resetCurrentProfileSettings();

    expect(result.success).toBe(true);
    const [resetProfile] = getProfiles();
    expect(resetProfile.settings.enabledProviders).toEqual(["openai", "ollama"]);
  });

  it("still preserves apiKey and models alongside enabledProviders", () => {
    const models: Model[] = [{ id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" }];
    const profile = buildProfile({
      settings: buildSettings({
        apiKey: "secret-key",
        models,
        enabledProviders: ["openai"],
      }),
    });
    seedProfiles([profile], profile.id);

    resetCurrentProfileSettings();

    const [resetProfile] = getProfiles();
    expect(resetProfile.settings.apiKey).toBe("secret-key");
    expect(resetProfile.settings.models).toEqual(models);
    expect(resetProfile.settings.enabledProviders).toEqual(["openai"]);
  });

  it("preserves providerEndpoints across a reset", () => {
    const profile = buildProfile({
      settings: buildSettings({
        providerEndpoints: { lmstudio: { host: "127.0.0.1", port: 1234 } },
      }),
    });
    seedProfiles([profile], profile.id);

    resetCurrentProfileSettings();

    const [resetProfile] = getProfiles();
    expect(resetProfile.settings.providerEndpoints).toEqual({
      lmstudio: { host: "127.0.0.1", port: 1234 },
    });
  });

  it("resets settingsCorrect to all 6 built-in defaults, including the two new presets", () => {
    const profile = buildProfile();
    seedProfiles([profile], profile.id);

    resetCurrentProfileSettings();

    const [resetProfile] = getProfiles();
    expect(resetProfile.settings.settingsCorrect.presets).toEqual(
      getDefaultCorrectionSettings().presets,
    );
    expect(
      resetProfile.settings.settingsCorrect.presets.find(
        (p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID,
      ),
    ).toBeDefined();
    expect(
      resetProfile.settings.settingsCorrect.presets.find(
        (p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID,
      ),
    ).toBeDefined();
  });
});

describe("createProfile — yields all 6 built-in presets", () => {
  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("creates a profile whose settingsCorrect.presets equals the default 6 built-ins", () => {
    const profile = createProfile("New Profile");

    expect(profile.settings.settingsCorrect.presets).toEqual(
      getDefaultCorrectionSettings().presets,
    );
    expect(profile.settings.settingsCorrect.presets).toHaveLength(6);
    const ids = profile.settings.settingsCorrect.presets.map((p) => p.id);
    expect(ids).toContain(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids).toContain(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
  });
});

describe("withoutProfileSecrets — strips apiKey and keeps every model field", () => {
  it("strips apiKey but returns models and selectedModel intact", () => {
    const models: Model[] = [{ id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" }];
    const profile = buildProfile({
      settings: buildSettings({
        apiKey: "secret-key",
        models,
        selectedModel: "openai::gpt-4o",
      }),
    });

    const result = withoutProfileSecrets(profile);

    expect(result.settings.apiKey).toBeUndefined();
    expect(result.settings.models).toEqual(models);
    expect(result.settings.selectedModel).toBe("openai::gpt-4o");
    expect(result).not.toHaveProperty("provider");
  });

  it("returns enabledProviders and every preset/feature model intact", () => {
    // Anything stripped here is permanently gone: profiles.ts writes this
    // result back to disk during the legacy-secret migration.
    const profile = buildProfile({
      settings: buildSettings({
        apiKey: "secret-key",
        enabledProviders: ["openai", "openrouter"],
        settingsSummarize: {
          minLength: 0,
          maxLength: 0,
          model: "openai::gpt-4o",
          targetLanguage: "en",
        },
      }),
    });

    const result = withoutProfileSecrets(profile);

    expect(result.settings.enabledProviders).toEqual(["openai", "openrouter"]);
    expect(
      result.settings.settingsCorrect.presets.map((preset) => preset.model),
    ).toEqual(["custom-model-a", "custom-model-b"]);
    expect(result.settings.settingsPromptGen.model).toBe("custom-model-c");
    expect(result.settings.settingsSummarize.model).toBe("openai::gpt-4o");
  });
});

describe("toExportableProfile — strips apiKey and every model field, keeping the rest", () => {
  const exportableFixture = (): Profile =>
    buildProfile({
      settings: buildSettings({
        apiKey: "secret-key",
        models: [{ id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" }],
        selectedModel: "openai::gpt-4o",
        enabledProviders: ["openai", "openrouter"],
        openaiProjectId: "proj_exporter",
        settingsSummarize: {
          minLength: 3,
          maxLength: 9,
          model: "openai::gpt-4o",
          targetLanguage: "ja",
        },
      }),
    });

  it("strips models, selectedModel, enabledProviders, the OpenAI project id, preset models and both feature models", () => {
    const result = toExportableProfile(exportableFixture());

    expect(result.settings.apiKey).toBeUndefined();
    expect(result.settings.models).toEqual([]);
    expect(result.settings.selectedModel).toBe("");
    expect(result.settings.enabledProviders).toEqual([]);
    // Names a project inside the exporter's own OpenAI organization.
    expect(result.settings.openaiProjectId).toBe("");
    expect(
      result.settings.settingsCorrect.presets.every((preset) => preset.model === ""),
    ).toBe(true);
    expect(result.settings.settingsPromptGen.model).toBe("");
    expect(result.settings.settingsSummarize.model).toBe("");
  });

  it("keeps every non-model setting, so an export is still a usable profile", () => {
    const result = toExportableProfile(exportableFixture());

    expect(result.id).toBe("profile_1");
    expect(result.name).toBe("Test Profile");
    expect(result.settings.settingsSummarize.minLength).toBe(3);
    expect(result.settings.settingsSummarize.targetLanguage).toBe("ja");
    expect(
      result.settings.settingsCorrect.presets.map((preset) => preset.systemPrompt),
    ).toEqual(["Fix grammar.", "Summarize."]);
  });

  it("differs from withoutProfileSecrets on exactly the machine-specific set", () => {
    const profile = exportableFixture();
    const secretsOnly = withoutProfileSecrets(profile);
    const exportable = toExportableProfile(profile);

    // The set the two disagree on — model cache plus account-local ids…
    expect(secretsOnly.settings.models).not.toEqual(exportable.settings.models);
    expect(secretsOnly.settings.selectedModel).not.toEqual(
      exportable.settings.selectedModel,
    );
    expect(secretsOnly.settings.enabledProviders).not.toEqual(
      exportable.settings.enabledProviders,
    );
    expect(secretsOnly.settings.openaiProjectId).not.toEqual(
      exportable.settings.openaiProjectId,
    );
    expect(
      secretsOnly.settings.settingsCorrect.presets.map((p) => p.model),
    ).not.toEqual(exportable.settings.settingsCorrect.presets.map((p) => p.model));
    expect(secretsOnly.settings.settingsPromptGen.model).not.toEqual(
      exportable.settings.settingsPromptGen.model,
    );
    expect(secretsOnly.settings.settingsSummarize.model).not.toEqual(
      exportable.settings.settingsSummarize.model,
    );

    // …and nothing else.
    const blanked = {
      ...secretsOnly,
      settings: {
        ...secretsOnly.settings,
        models: [],
        selectedModel: "",
        enabledProviders: [],
        providerEndpoints: {},
        openaiProjectId: "",
        settingsCorrect: {
          ...secretsOnly.settings.settingsCorrect,
          presets: secretsOnly.settings.settingsCorrect.presets.map((preset) => ({
            ...preset,
            model: "",
          })),
        },
        settingsPromptGen: { ...secretsOnly.settings.settingsPromptGen, model: "" },
        settingsSummarize: { ...secretsOnly.settings.settingsSummarize, model: "" },
      },
    };
    expect(exportable).toEqual(blanked);
  });

  it("does not mutate the profile it was given", () => {
    const profile = exportableFixture();
    const snapshot = structuredClone(profile);

    toExportableProfile(profile);

    expect(profile).toEqual(snapshot);
  });

  it("sanitizeImportedProfile is toExportableProfile — an imported cache describes another machine", () => {
    expect(sanitizeImportedProfile).toBe(toExportableProfile);
  });

  it("invents neither new built-in preset — a profile stored without them exports with the same preset ids", () => {
    // exportableFixture()'s settingsCorrect carries only "correction" and
    // "summarize" (the buildSettings() default). toExportableProfile must
    // never run normalizeCorrectionSettings-style materialization.
    const result = toExportableProfile(exportableFixture());
    const ids = result.settings.settingsCorrect.presets.map((p) => p.id);

    expect(ids).toEqual(["correction", "summarize"]);
    expect(ids).not.toContain(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids).not.toContain(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
  });

  it("blanks the model on a stored copy of each new built-in without adding or dropping presets", () => {
    const profile = buildProfile({
      settings: buildSettings({
        settingsCorrect: {
          selectedPresetId: DEFAULT_BUSINESS_WRITING_PRESET_ID,
          presets: [
            {
              id: DEFAULT_BUSINESS_WRITING_PRESET_ID,
              name: "Business Writing",
              hotkey: "Control+Shift+B",
              systemPrompt: "Business writing prompt.",
              model: "openai::gpt-4o",
              isBuiltIn: true,
            },
            {
              id: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
              name: "Context-Aware Structured Text",
              hotkey: "Control+Shift+R",
              systemPrompt: "Structured text prompt.",
              model: "openai::gpt-4o",
              isBuiltIn: true,
            },
          ],
        },
      }),
    });

    const result = toExportableProfile(profile);
    const ids = result.settings.settingsCorrect.presets.map((p) => p.id);

    expect(ids).toEqual([
      DEFAULT_BUSINESS_WRITING_PRESET_ID,
      DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    ]);
    expect(
      result.settings.settingsCorrect.presets.every((p) => p.model === ""),
    ).toBe(true);
  });
});

describe("migrateStoredProfilesForModelRefs", () => {
  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
    apiStore.set("configVersion", 0);
  });

  it("migrates raw legacy profiles and bumps configVersion to 1", () => {
    apiStore.set("profiles", [
      {
        id: "profile_1",
        name: "Legacy Profile",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        provider: "openai",
        settings: buildSettings({ selectedModel: "gpt-4o" }),
      },
    ]);

    migrateStoredProfilesForModelRefs();

    expect(apiStore.get("configVersion")).toBe(1);
    const [migrated] = getProfiles();
    expect(migrated.settings.selectedModel).toBe("openai::gpt-4o");
    expect(migrated).not.toHaveProperty("provider");
  });

  it("does not run when configVersion is already >= 1", () => {
    apiStore.set("configVersion", 1);
    apiStore.set("profiles", [
      {
        id: "profile_1",
        name: "Untouched Profile",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        provider: "openai",
        settings: buildSettings({ selectedModel: "gpt-4o" }),
      },
    ]);

    migrateStoredProfilesForModelRefs();

    const rawProfiles = apiStore.get("profiles") as Record<string, unknown>[];
    expect(rawProfiles[0].provider).toBe("openai");
    expect(
      (rawProfiles[0].settings as SettingsStore).selectedModel,
    ).toBe("gpt-4o");
  });

  it("with configVersion forced back to 0 and already-migrated profiles on disk, replaying the driver rewrites nothing", () => {
    apiStore.set("profiles", [
      {
        id: "profile_1",
        name: "Legacy Profile",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        provider: "openai",
        settings: buildSettings({ selectedModel: "gpt-4o" }),
      },
    ]);

    migrateStoredProfilesForModelRefs();
    const afterFirstRun = getProfiles();

    apiStore.set("configVersion", 0);
    migrateStoredProfilesForModelRefs();
    const afterSecondRun = getProfiles();

    expect(afterSecondRun).toEqual(afterFirstRun);
  });

  it("initializeDefaultProfile runs the migration before ensuring a default profile exists", () => {
    apiStore.set("profiles", [
      {
        id: "profile_1",
        name: "Legacy Profile",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        provider: "ollama",
        settings: buildSettings({ selectedModel: "local-model" }),
      },
    ]);
    apiStore.set("currentProfileId", "profile_1");

    initializeDefaultProfile();

    expect(apiStore.get("configVersion")).toBe(1);
    const [migrated] = getProfiles();
    expect(migrated.settings.selectedModel).toBe("ollama::local-model");
  });
});

// A migrated profile must survive real ajv validation — the whole reason
// `enabledProviders` carries no `enum`.
describe("apiStoreSchema — real schema round trip (clearInvalidConfig safety)", () => {
  it("round-trips a migrated profile through the real validation engine without wiping it", async () => {
    const { default: Conf } = await import("conf");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fixlang-apistore-schema-"));

    try {
      // A throwaway cwd: this must never touch a real user config file.
      const realStore = new Conf<{ profiles: Profile[] }>({
        cwd,
        configName: "config",
        clearInvalidConfig: true,
        schema: apiStoreSchema,
      });

      const migrated = migrateProfileForModelRefs({
        id: "profile_1",
        name: "Test Profile",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        provider: "openai",
        settings: buildSettings({ selectedModel: "gpt-4o" }),
      });

      realStore.set("profiles", [migrated]);
      const readBack = realStore.get("profiles", []);

      expect(readBack).toHaveLength(1);
      expect(readBack[0].settings.selectedModel).toBe("openai::gpt-4o");
      expect(readBack[0].settings.enabledProviders).toEqual(["openai"]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("resolveDefaultModel", () => {
  it("returns null for an empty list", () => {
    expect(resolveDefaultModel([])).toBeNull();
  });

  it("picks the newest model whose id contains both gpt and mini", () => {
    const models: Model[] = [
      { id: "gpt-4o-mini", name: "gpt-4o-mini", created: 1, provider: "openai" },
      { id: "gpt-4.1-mini", name: "gpt-4.1-mini", created: 2, provider: "openai" },
      { id: "gpt-4o", name: "gpt-4o", created: 3, provider: "openai" },
    ];
    expect(resolveDefaultModel(models)?.id).toBe("gpt-4.1-mini");
  });

  it("falls back to the first model when none match gpt+mini", () => {
    const models: Model[] = [
      { id: "claude-3-opus", name: "claude-3-opus", created: 1, provider: "openrouter" },
      { id: "claude-3-sonnet", name: "claude-3-sonnet", created: 2, provider: "openrouter" },
    ];
    expect(resolveDefaultModel(models)?.id).toBe("claude-3-opus");
  });
});

describe("resolveDefaultOpenAIModel — legacy delegate stays byte-for-byte compatible", () => {
  it("returns the same id resolveDefaultModel would resolve", () => {
    const models = [
      { id: "gpt-4o-mini", created: 1 },
      { id: "gpt-4.1-mini", created: 2 },
    ];
    expect(resolveDefaultOpenAIModel(models)).toBe("gpt-4.1-mini");
  });

  it("falls back to DEFAULT_OPENAI_MODEL for an empty list", () => {
    expect(resolveDefaultOpenAIModel([])).toBe("openai/gpt-4.1-mini");
  });
});
