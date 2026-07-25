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
import {
  apiStore,
  commitActiveProfileProviderSetup,
  isModelForProvider,
} from "~/stores/apiStore";
import type { Model, Profile, SettingsStore } from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildSettings = (overrides: Partial<SettingsStore> = {}): SettingsStore =>
  ({
    apiKey: "",
    models: [],
    selectedModel: "",
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
    provider: "openrouter",
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

  it("sets selectedModel and provider on the committed profile", () => {
    const profile = buildProfile({ provider: "ollama" });
    seedProfiles([profile], profile.id);

    const result = commitActiveProfileProviderSetup("openai", "openai/gpt-4o", [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1 },
    ]);

    expect(result?.provider).toBe("openai");
    expect(result?.settings.selectedModel).toBe("openai/gpt-4o");
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
