/**
 * @file apiStore.test.ts
 * @description Tests for provider-aware model caching and the staged
 * provider-setup commit path. Pure unit tests — no Electron, no IPC, no
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
  disconnectProviderFromActiveProfile,
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

// ---------------------------------------------------------------------------
// connectProviderToActiveProfile — D10.
//
// This describe block REPLACES the old `commitActiveProfileProviderSetup`
// suite, which asserted that committing a provider wiped every preset model
// and `settingsPromptGen.model` to the inherit sentinel. That wipe is the
// behaviour this card deletes, so the assertions below are its exact inverse:
// connecting a provider must leave every existing model choice byte-identical.
// ---------------------------------------------------------------------------

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

describe("connectProviderToActiveProfile — D10", () => {
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
    // Every persisted entry is tagged, so `modelRefForModel` cannot mislabel it.
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

// ---------------------------------------------------------------------------
// disconnectProviderFromActiveProfile — D11
// ---------------------------------------------------------------------------

describe("disconnectProviderFromActiveProfile — D11", () => {
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

// ---------------------------------------------------------------------------
// Re-exports from ~/shared/providers (card 03: apiStore.ts must not redefine
// these — it must re-export the ~/shared/providers originals verbatim so the
// ~40 existing importers of these names from apiStore keep compiling).
// ---------------------------------------------------------------------------

describe("apiStore re-exports from ~/shared/providers", () => {
  it("PROVIDER_IDS, isProviderId and isModelForProvider are the exact ~/shared/providers exports", () => {
    expect(PROVIDER_IDS).toBe(sharedProviderIds);
    expect(isProviderId).toBe(sharedIsProviderId);
    expect(isModelForProvider).toBe(sharedIsModelForProvider);
  });
});

// ---------------------------------------------------------------------------
// D9 — Profile has no `provider` field; the schema has no `provider`
// property. (`bunx tsc --noEmit` covers the type-level half of D9; these
// assertions cover the schema/runtime half.)
// ---------------------------------------------------------------------------

describe("apiStoreSchema — provider removal and enabledProviders (D9)", () => {
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

// ---------------------------------------------------------------------------
// Model schema defaults become "" (inherit); configVersion defaults to 0.
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// getDefaultModelId
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// resetCurrentProfileSettings preserves enabledProviders (D12)
// ---------------------------------------------------------------------------

describe("resetCurrentProfileSettings — D12", () => {
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
});

// ---------------------------------------------------------------------------
// withoutProfileSecrets — D13, first half (unchanged aside from the removed
// normalizeProfileProvider call; still strips only secrets).
// ---------------------------------------------------------------------------

describe("withoutProfileSecrets — D13 (first half)", () => {
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
    // The exact reason this helper must stay narrow: profiles.ts:98 writes its
    // result back to disk during the legacy-secret migration, so anything it
    // strips is permanently gone from an upgrading user's config.
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

// ---------------------------------------------------------------------------
// toExportableProfile — D13, second half. Everything model-shaped is stripped,
// and a paired assertion pins that the two helpers differ on EXACTLY that set.
// ---------------------------------------------------------------------------

describe("toExportableProfile — D13 (second half)", () => {
  const exportableFixture = (): Profile =>
    buildProfile({
      settings: buildSettings({
        apiKey: "secret-key",
        models: [{ id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" }],
        selectedModel: "openai::gpt-4o",
        enabledProviders: ["openai", "openrouter"],
        settingsSummarize: {
          minLength: 3,
          maxLength: 9,
          model: "openai::gpt-4o",
          targetLanguage: "ja",
        },
      }),
    });

  it("strips models, selectedModel, enabledProviders, preset models and both feature models", () => {
    const result = toExportableProfile(exportableFixture());

    expect(result.settings.apiKey).toBeUndefined();
    expect(result.settings.models).toEqual([]);
    expect(result.settings.selectedModel).toBe("");
    expect(result.settings.enabledProviders).toEqual([]);
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

  it("differs from withoutProfileSecrets on exactly the model-state set", () => {
    const profile = exportableFixture();
    const secretsOnly = withoutProfileSecrets(profile);
    const exportable = toExportableProfile(profile);

    // The set the two disagree on…
    expect(secretsOnly.settings.models).not.toEqual(exportable.settings.models);
    expect(secretsOnly.settings.selectedModel).not.toEqual(
      exportable.settings.selectedModel,
    );
    expect(secretsOnly.settings.enabledProviders).not.toEqual(
      exportable.settings.enabledProviders,
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

    // …and nothing else. Blanking the model fields on the secrets-only copy
    // must make the two byte-identical.
    const blanked = {
      ...secretsOnly,
      settings: {
        ...secretsOnly.settings,
        models: [],
        selectedModel: "",
        enabledProviders: [],
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
});

// ---------------------------------------------------------------------------
// Migration wiring — `initializeDefaultProfile` / `migrateStoredProfilesForModelRefs`
// ---------------------------------------------------------------------------

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

    // Untouched: still has the raw, unmigrated shape (still has a raw
    // provider key, still has an unprefixed selectedModel) because the
    // version gate short-circuited before the migration ran.
    const rawProfiles = apiStore.get("profiles") as Record<string, unknown>[];
    expect(rawProfiles[0].provider).toBe("openai");
    expect(
      (rawProfiles[0].settings as SettingsStore).selectedModel,
    ).toBe("gpt-4o");
  });

  it("D15b — with configVersion forced back to 0 and already-migrated profiles on disk, replaying the driver rewrites nothing", () => {
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

    // Force the gate back to 0, simulating a bug or a manual rollback.
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

// ---------------------------------------------------------------------------
// Real electron-store schema round trip (via the `conf` package electron-store
// wraps): a migrated profile must not trip `clearInvalidConfig` — the whole
// reason `enabledProviders` has no ajv `enum` above.
// ---------------------------------------------------------------------------

describe("apiStoreSchema — real schema round trip (clearInvalidConfig safety)", () => {
  it("round-trips a migrated profile through the real validation engine without wiping it", async () => {
    const { default: Conf } = await import("conf");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fixlang-apistore-schema-"));

    try {
      // Real ajv-backed validator (the same engine electron-store uses under
      // the hood — `Schema` is literally re-exported from `conf`), isolated
      // to a throwaway temp directory so this never touches a real user
      // config file.
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

// ---------------------------------------------------------------------------
// const.ts — resolveDefaultModel / resolveDefaultOpenAIModel (nearest
// existing test, per the card's Scope note: no dedicated const.test.ts
// exists yet, and no other test currently exercises these functions).
// ---------------------------------------------------------------------------

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
