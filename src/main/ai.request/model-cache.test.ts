/**
 * @file model-cache.test.ts
 * @description Tests for provider-scoped model cache persistence in
 * fetchAvailableModels: fetching with persistCache=false must never write the
 * profile's cached models; fetching with persistCache=true must replace only
 * the fetched provider's entries while preserving other providers' cached
 * models; and an empty fetch result must never clear the existing cache.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const { openAIModelsListMock } = vi.hoisted(() => ({
  openAIModelsListMock: vi.fn(),
}));
// Stateful mock of electron-store so seeded profiles/currentProfileId are
// readable by the real apiStore.ts helpers, and writes are observable.
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
vi.mock("electron", () => ({
  app: {
    isReady: vi.fn().mockReturnValue(true),
    getPath: vi.fn().mockReturnValue("/tmp"),
    once: vi.fn(),
  },
  Notification: class {
    show = vi.fn();
    on = vi.fn().mockReturnThis();
  },
}));
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn(() => ({ provider: "openrouter" }))),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn() })),
}));
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("openai", () => ({
  OpenAI: class {
    models = { list: openAIModelsListMock };
  },
}));
vi.mock("~/stores/apiKeyStore", () => ({
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));
vi.mock("~/stores/profileSecretStore", () => ({
  getProfileSecret: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/main/llm/models/discover", () => ({
  getLocalModels: vi.fn().mockResolvedValue([]),
}));
vi.mock("../llm", () => ({
  ollamaClient: { chat: vi.fn() },
}));
// Imports (after mocks) — the real implementation under test.
import { apiStore, getProfiles } from "~/stores/apiStore";
import { fetchAvailableModels } from "./shared";
import type { Model, Profile, SettingsStore } from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildSettings = (models: Model[]): SettingsStore =>
  ({
    apiKey: "",
    models,
    selectedModel: "",
    customSystemPrompt: "",
    customUserPrompt: "",
    tone: "",
    settingsCorrect: { presets: [], selectedPresetId: "" },
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
      model: "",
    },
  }) as SettingsStore;

const buildProfile = (models: Model[]): Profile =>
  ({
    id: "profile_1",
    name: "Test Profile",
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
    provider: "openai",
    settings: buildSettings(models),
  }) as Profile;

const seedProfile = (models: Model[]): void => {
  apiStore.set("profiles", [buildProfile(models)]);
  apiStore.set("currentProfileId", "profile_1");
};

const currentModels = (): Model[] => getProfiles()[0]?.settings.models ?? [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchAvailableModels — cache persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("does not write the profile cache when persistCache is false", async () => {
    const existing: Model[] = [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    seedProfile(existing);
    openAIModelsListMock.mockResolvedValue({
      data: [{ id: "openai/gpt-4.1-mini", created: 2 }],
    });

    const result = await fetchAvailableModels("key", "openai", false);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openai/gpt-4.1-mini");
    // Cache must be untouched — still exactly the pre-existing entry.
    expect(currentModels()).toEqual(existing);
  });

  it("replaces only the fetched provider's entries and preserves others when persistCache is true", async () => {
    const existingOpenAi: Model = {
      id: "openai/gpt-4o",
      name: "gpt-4o",
      created: 1,
      provider: "openai",
    };
    const existingOllama: Model = {
      id: "llama-70b",
      name: "llama-70b",
      created: 2,
      local: { path: "/models/llama-70b" },
    };
    seedProfile([existingOpenAi, existingOllama]);
    openAIModelsListMock.mockResolvedValue({
      data: [{ id: "openai/gpt-4.1-mini", created: 3 }],
    });

    await fetchAvailableModels("key", "openai", true);

    const models = currentModels();
    expect(models).toHaveLength(2);
    expect(models).toContainEqual(existingOllama);
    expect(models.some((m) => m.id === "openai/gpt-4o")).toBe(false);
    expect(
      models.some((m) => m.id === "openai/gpt-4.1-mini" && m.provider === "openai"),
    ).toBe(true);
  });

  it("does not clear the cache when the fetch result is empty", async () => {
    const existing: Model[] = [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    seedProfile(existing);
    openAIModelsListMock.mockResolvedValue({ data: [] });

    const result = await fetchAvailableModels("key", "openai", true);

    expect(result).toEqual([]);
    // Empty fetch result must not wipe the previously cached entries.
    expect(currentModels()).toEqual(existing);
  });
});

// ---------------------------------------------------------------------------
// strict validation (M1): a live-fetch failure must surface as a rejection,
// never silently fall back to a stale cached model list, for providers that
// require a key. Ollama keeps the resilient cache-fallback behavior.
// ---------------------------------------------------------------------------

describe("fetchAvailableModels — strict validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("rejects instead of falling back to cache when strict and the key is invalid (openai)", async () => {
    const existing: Model[] = [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    seedProfile(existing);
    openAIModelsListMock.mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      fetchAvailableModels("stale-or-revoked-key", "openai", false, true),
    ).rejects.toThrow("401 Unauthorized");
    // The stale cache must be left exactly as it was — no silent write.
    expect(currentModels()).toEqual(existing);
  });

  it("falls back to cache as before when strict is false (non-apply callers unaffected)", async () => {
    const existing: Model[] = [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    seedProfile(existing);
    openAIModelsListMock.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await fetchAvailableModels("stale-or-revoked-key", "openai", false, false);

    expect(result).toEqual(existing);
  });
});
