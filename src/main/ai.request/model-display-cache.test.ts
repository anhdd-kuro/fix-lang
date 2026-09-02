/**
 * @file model-display-cache.test.ts
 * @description Tests for the cache-first display path (`fetchModelsForDisplay`)
 * that stops every ModelSelect mount / dashboard tab open from re-hitting the
 * provider HTTP API. The contract under test: a display fetch is served from
 * the profile-persisted cache only when `refetch` is falsy AND that provider's
 * cache is non-empty AND a genuine live provider fetch happened in THIS process
 * within `MODEL_DISPLAY_CACHE_TTL_MS`. Everything else must fetch live.
 *
 * Each test loads a fresh module graph (`vi.resetModules()`) so the
 * main-process-only freshness map starts empty, exactly like an app launch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("~/features/providers/store/apiKeyStore", () => ({
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/main/llm/models/discover", () => ({
  getLocalModels: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/main/llm/providers/ollama/client", () => ({
  createOllamaClient: () => ({ chat: vi.fn() }), ollamaClient: { chat: vi.fn() },
}));
import type { Model, Profile, SettingsStore } from "~/features/providers/store/apiStore";

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

const cachedOpenAiModel: Model = {
  id: "openai/gpt-4o",
  name: "gpt-4o",
  created: 1,
  provider: "openai",
};

/**
 * Fresh module graph per test: `vi.resetModules()` gives a brand-new freshness
 * map (empty, like an app launch) AND a brand-new electron-store instance, so
 * `seed` decides what a "previous run" had persisted.
 */
const loadFresh = async (seed: Model[]) => {
  vi.resetModules();
  const apiStoreModule = await import("~/features/providers/store/apiStore");
  apiStoreModule.apiStore.set("profiles", [buildProfile(seed)]);
  apiStoreModule.apiStore.set("currentProfileId", "profile_1");
  const sharedModule = await import("./shared");
  return { ...sharedModule, apiStore: apiStoreModule.apiStore };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchModelsForDisplay — cache-first display path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    openAIModelsListMock.mockResolvedValue({
      data: [{ id: "openai/gpt-4.1-mini", created: 2 }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the cache without any provider call on a second fetch inside the TTL", async () => {
    const { fetchModelsForDisplay } = await loadFresh([]);

    const first = await fetchModelsForDisplay("key", "openai");
    expect(openAIModelsListMock).toHaveBeenCalledTimes(1);
    expect(first.map((model) => model.id)).toEqual(["openai/gpt-4.1-mini"]);

    vi.advanceTimersByTime(60_000);
    const second = await fetchModelsForDisplay("key", "openai");

    // No second provider round-trip — the tab open was free.
    expect(openAIModelsListMock).toHaveBeenCalledTimes(1);
    expect(second.map((model) => model.id)).toEqual(["openai/gpt-4.1-mini"]);
  });

  it("always performs a provider call when refetch is true", async () => {
    const { fetchModelsForDisplay } = await loadFresh([]);

    await fetchModelsForDisplay("key", "openai");
    expect(openAIModelsListMock).toHaveBeenCalledTimes(1);

    // Immediately afterwards, well inside the TTL: the ↻ button must still hit
    // the provider.
    await fetchModelsForDisplay("key", "openai", true);
    expect(openAIModelsListMock).toHaveBeenCalledTimes(2);
  });

  it("performs a provider call once the TTL has expired", async () => {
    const { fetchModelsForDisplay, MODEL_DISPLAY_CACHE_TTL_MS } = await loadFresh([]);

    await fetchModelsForDisplay("key", "openai");
    expect(openAIModelsListMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MODEL_DISPLAY_CACHE_TTL_MS + 1);
    await fetchModelsForDisplay("key", "openai");

    expect(openAIModelsListMock).toHaveBeenCalledTimes(2);
  });

  it("performs a provider call when the provider cache is empty", async () => {
    // Provider answers with nothing, so nothing is persisted and the cache
    // stays empty even though a live fetch just succeeded.
    openAIModelsListMock.mockResolvedValue({ data: [] });
    const { fetchModelsForDisplay } = await loadFresh([]);

    await fetchModelsForDisplay("key", "openai");
    expect(openAIModelsListMock).toHaveBeenCalledTimes(1);

    await fetchModelsForDisplay("key", "openai");

    // Empty cache can never satisfy a display read.
    expect(openAIModelsListMock).toHaveBeenCalledTimes(2);
  });

  it("still fetches live once when the cache came from a previous run", async () => {
    // Cache persisted by an earlier process; no live fetch in THIS one, so the
    // freshness map is empty and a launch must see fresh models.
    const { fetchModelsForDisplay } = await loadFresh([cachedOpenAiModel]);

    const models = await fetchModelsForDisplay("key", "openai");

    expect(openAIModelsListMock).toHaveBeenCalledTimes(1);
    expect(models.map((model) => model.id)).toEqual(["openai/gpt-4.1-mini"]);

    // …and the freshly warmed cache then serves the next mount for free.
    await fetchModelsForDisplay("key", "openai");
    expect(openAIModelsListMock).toHaveBeenCalledTimes(1);
  });
});
