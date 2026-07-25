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
  commitActiveProfileProviderSetup,
  getDefaultModelId,
  getProfiles,
  initializeDefaultProfile,
  isModelForProvider,
  isProviderId,
  migrateStoredProfilesForModelRefs,
  PROVIDER_IDS,
  resetCurrentProfileSettings,
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
// commitActiveProfileProviderSetup
// ---------------------------------------------------------------------------

describe("commitActiveProfileProviderSetup", () => {
  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("returns null when there is no active profile", () => {
    seedProfiles([buildProfile()], "");
    const result = commitActiveProfileProviderSetup("openai", "openai/gpt-4o", []);
    expect(result).toBeNull();
  });

  it("returns null when the active profile id does not match any profile", () => {
    seedProfiles([buildProfile({ id: "profile_1" })], "profile_missing");
    const result = commitActiveProfileProviderSetup("openai", "openai/gpt-4o", []);
    expect(result).toBeNull();
  });

  it("replaces only the target provider's cached models, retaining other providers' entries", () => {
    const existingOpenAiModel: Model = {
      id: "openai/gpt-4o",
      name: "gpt-4o",
      created: 1,
      provider: "openai",
    };
    const existingLocalModel: Model = {
      id: "llama-70b",
      name: "llama-70b",
      created: 2,
      local: { path: "/models/llama-70b" },
    };
    const profile = buildProfile({
      settings: buildSettings({ models: [existingOpenAiModel, existingLocalModel] }),
    });
    seedProfiles([profile], profile.id);

    const newOpenAiModels: Model[] = [
      { id: "openai/gpt-4o-mini", name: "gpt-4o-mini", created: 3 },
    ];
    const result = commitActiveProfileProviderSetup(
      "openai",
      "openai/gpt-4o-mini",
      newOpenAiModels,
    );

    expect(result?.settings.models).toHaveLength(2);
    // The ollama-tagged (local) entry is retained untouched.
    expect(result?.settings.models).toContainEqual(existingLocalModel);
    // The old openai entry is gone; the newly fetched one replaces it, tagged
    // with the provider it was fetched for.
    expect(result?.settings.models).not.toContainEqual(existingOpenAiModel);
    expect(result?.settings.models).toContainEqual({
      ...newOpenAiModels[0],
      provider: "openai",
    });
  });

  it("sets selectedModel on the committed profile", () => {
    const profile = buildProfile();
    seedProfiles([profile], profile.id);

    const result = commitActiveProfileProviderSetup("openai", "openai/gpt-4o", [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1 },
    ]);

    expect(result?.settings.selectedModel).toBe("openai/gpt-4o");
    // Profile.provider no longer exists (card 03) — the committed profile
    // carries no such field at all.
    expect(result).not.toHaveProperty("provider");
  });

  it("clears every Correction preset model and settingsPromptGen.model to inherit", () => {
    const profile = buildProfile();
    seedProfiles([profile], profile.id);

    const result = commitActiveProfileProviderSetup("openai", "openai/gpt-4o", []);

    expect(
      result?.settings.settingsCorrect.presets.every((preset) => preset.model === ""),
    ).toBe(true);
    expect(result?.settings.settingsPromptGen.model).toBe("");
  });

  it("updates updatedAt", () => {
    const profile = buildProfile({ updatedAt: "2000-01-01T00:00:00.000Z" });
    seedProfiles([profile], profile.id);

    const result = commitActiveProfileProviderSetup("openai", "openai/gpt-4o", []);

    expect(result?.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
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
