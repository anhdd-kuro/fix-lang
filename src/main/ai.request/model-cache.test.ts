/**
 * @file model-cache.test.ts
 * @description Tests for provider-scoped model cache persistence in
 * fetchAvailableModels: fetching with persistCache=false must never write the
 * profile's cached models; fetching with persistCache=true must replace only
 * the fetched provider's entries while preserving other providers' cached
 * models; and an empty fetch result must never clear the existing cache —
 * except for a reachable Ollama, where empty is the user's own deletion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { openAIModelsListMock, getLocalModelsMock, probeOllamaMock } = vi.hoisted(() => ({
  openAIModelsListMock: vi.fn(),
  getLocalModelsMock: vi.fn().mockResolvedValue([]),
  probeOllamaMock: vi.fn().mockResolvedValue({ reachable: true, models: [] }),
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
  getLocalModels: getLocalModelsMock,
  probeOllama: probeOllamaMock,
}));
vi.mock("../llm", () => ({
  ollamaClient: { chat: vi.fn() },
}));
// Imports (after mocks) — the real implementation under test.
import { apiStore, getProfiles } from "~/stores/apiStore";
import { fetchAvailableModels, fetchModelsForProviders } from "./shared";
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

  it("does not clear the cache when a cloud fetch fails outright", async () => {
    const existing: Model[] = [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    seedProfile(existing);
    openAIModelsListMock.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await fetchAvailableModels("revoked-key", "openai", true);

    expect(result).toEqual(existing);
    expect(currentModels()).toEqual(existing);
  });
});

// ---------------------------------------------------------------------------
// A removed local model must actually leave the cache. `[]` from a REACHABLE
// Ollama means the user deleted their models; `[]` from a down daemon means
// nothing at all, and the two must not persist the same way.
// ---------------------------------------------------------------------------

describe("fetchAvailableModels — an empty Ollama result", () => {
  const cachedOllama: Model = {
    id: "llama3.2:3b",
    name: "llama3.2",
    created: 2,
    provider: "ollama",
    local: { path: "llama3.2:3b" },
  };
  const cachedOpenAi: Model = {
    id: "gpt-4o",
    name: "gpt-4o",
    created: 1,
    provider: "openai",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("clears the Ollama slice when the daemon is reachable and has nothing pulled", async () => {
    seedProfile([cachedOpenAi, cachedOllama]);
    probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });

    const result = await fetchAvailableModels("", "ollama", true);

    expect(result).toEqual([]);
    // The removed model is gone; the cloud slice is untouched.
    expect(currentModels()).toEqual([cachedOpenAi]);
    expect(probeOllamaMock).toHaveBeenCalled();
  });

  it("leaves the Ollama slice alone when the probe could not reach the daemon", async () => {
    seedProfile([cachedOpenAi, cachedOllama]);
    probeOllamaMock.mockResolvedValue({
      reachable: false,
      models: [],
      error: "connect ECONNREFUSED 127.0.0.1:11434",
    });

    const result = await fetchAvailableModels("", "ollama", true);

    expect(probeOllamaMock).toHaveBeenCalled();
    expect(result).toEqual([]);
    expect(currentModels()).toEqual([cachedOpenAi, cachedOllama]);
  });

  it("still replaces the Ollama slice when the daemon has models", async () => {
    seedProfile([cachedOpenAi, cachedOllama]);
    const pulled: Model = {
      id: "qwen2.5-coder:7b",
      name: "qwen2.5-coder",
      created: 3,
      provider: "ollama",
      local: { path: "qwen2.5-coder:7b" },
    };
    probeOllamaMock.mockResolvedValue({ reachable: true, models: [pulled] });

    await fetchAvailableModels("", "ollama", true);

    expect(currentModels()).toEqual([cachedOpenAi, pulled]);
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

describe("fetchModelsForProviders — fan-out across every enabled provider", () => {
  const openRouterPayload = (models: { id: string; created: number }[]) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      data: models.map((model) => ({ ...model, name: model.id })),
    }),
  });

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    openAIModelsListMock.mockResolvedValue({
      data: [{ id: "gpt-4o", created: 100 }],
    });
    fetchMock.mockResolvedValue(
      openRouterPayload([{ id: "anthropic/claude-3.5-sonnet", created: 200 }]),
    );
    probeOllamaMock.mockResolvedValue({
      reachable: true,
      models: [
        {
          id: "llama3.2:3b",
          name: "llama3.2",
          // Milliseconds, where the cloud providers use seconds.
          created: 1_700_000_000_000,
          provider: "ollama",
          local: { path: "/models/llama3.2" },
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves all three slices present after exactly ONE profile write", async () => {
    seedProfile([]);
    const setSpy = vi.spyOn(apiStore, "set");

    const result = await fetchModelsForProviders(
      ["openai", "openrouter", "ollama"],
      { openai: "openai-key", openrouter: "openrouter-key" },
      true,
    );

    // The write COUNT is the real assertion: three surviving slices can happen
    // by luck of scheduling, one write cannot.
    const writtenKeys = setSpy.mock.calls.map((call) => String(call[0]));
    expect(writtenKeys).toEqual(["profiles"]);
    expect(setSpy).toHaveBeenCalledTimes(1);

    const persisted = currentModels();
    expect(persisted.map((model) => model.id)).toEqual([
      "gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "llama3.2:3b",
    ]);
    // Untagged entries format as `openrouter::…` refs whatever their shape.
    expect(persisted.map((model) => model.provider)).toEqual([
      "openai",
      "openrouter",
      "ollama",
    ]);
    expect(result.errors).toEqual({});
    expect(result.models.map((model) => model.id)).toEqual(
      persisted.map((model) => model.id),
    );
    setSpy.mockRestore();
  });

  it("one provider failing still returns the others and keeps the failed slice", async () => {
    const staleOpenRouter: Model = {
      id: "anthropic/claude-3-opus",
      name: "claude-3-opus",
      created: 5,
      provider: "openrouter",
    };
    seedProfile([staleOpenRouter]);
    fetchMock.mockRejectedValue(new Error("openrouter is down"));

    const result = await fetchModelsForProviders(
      ["openai", "openrouter", "ollama"],
      { openai: "openai-key", openrouter: "openrouter-key" },
      true,
    );

    expect(Object.keys(result.errors)).toEqual(["openrouter"]);
    expect(result.errors.openrouter).toContain("openrouter is down");

    const ids = result.models.map((model) => model.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("llama3.2:3b");
    // The failed provider keeps exactly what it had cached — not blanked.
    expect(result.models).toContainEqual(staleOpenRouter);
    expect(currentModels()).toContainEqual(staleOpenRouter);
  });

  it("groups by provider in PROVIDER_ORDER and sorts within a group, never globally", async () => {
    seedProfile([]);
    openAIModelsListMock.mockResolvedValue({
      data: [
        { id: "gpt-4o-mini", created: 10 },
        { id: "gpt-4o", created: 900 },
      ],
    });

    const result = await fetchModelsForProviders(
      ["ollama", "openrouter", "openai"],
      { openai: "openai-key", openrouter: "openrouter-key" },
      true,
    );

    // Ollama's millisecond `created` dwarfs every cloud value, so a global
    // sort would hoist it to the front. Grouping keeps it last.
    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-4o",
      "gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "llama3.2:3b",
    ]);
  });

  it("leaves a provider that was not asked for completely untouched", async () => {
    const untouchedOllama: Model = {
      id: "mistral:7b",
      name: "mistral",
      created: 7,
      provider: "ollama",
      local: { path: "/models/mistral" },
    };
    seedProfile([untouchedOllama]);

    const result = await fetchModelsForProviders(
      ["openai"],
      { openai: "openai-key" },
      true,
    );

    expect(probeOllamaMock).not.toHaveBeenCalled();
    expect(result.models).toContainEqual(untouchedOllama);
    expect(currentModels()).toContainEqual(untouchedOllama);
  });

  it("clears the Ollama slice when the daemon is reachable with nothing pulled", async () => {
    const cachedOllama: Model = {
      id: "llama3.2:3b",
      name: "llama3.2",
      created: 1_700_000_000_000,
      provider: "ollama",
      local: { path: "/models/llama3.2" },
    };
    seedProfile([cachedOllama]);
    probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });

    const result = await fetchModelsForProviders(
      ["openai", "openrouter", "ollama"],
      { openai: "openai-key", openrouter: "openrouter-key" },
      true,
    );

    expect(result.errors).toEqual({});
    // The user deleted their last local model — the cloud slices are untouched.
    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-4o",
      "anthropic/claude-3.5-sonnet",
    ]);
    expect(currentModels().map((model) => model.id)).toEqual([
      "gpt-4o",
      "anthropic/claude-3.5-sonnet",
    ]);
  });

  it("keeps the cached Ollama slice when the daemon is unreachable", async () => {
    const cachedOllama: Model = {
      id: "llama3.2:3b",
      name: "llama3.2",
      created: 1_700_000_000_000,
      provider: "ollama",
      local: { path: "/models/llama3.2" },
    };
    seedProfile([cachedOllama]);
    probeOllamaMock.mockResolvedValue({
      reachable: false,
      models: [],
      error: "connect ECONNREFUSED 127.0.0.1:11434",
    });

    const result = await fetchModelsForProviders(
      ["openai", "openrouter", "ollama"],
      { openai: "openai-key", openrouter: "openrouter-key" },
      true,
    );

    expect(result.errors).toEqual({});
    expect(result.models).toContainEqual(cachedOllama);
    expect(currentModels()).toContainEqual(cachedOllama);
  });

  it("keeps a cloud provider's cached slice when its fetch returns nothing", async () => {
    const cachedOpenAi: Model = {
      id: "gpt-4o-mini",
      name: "gpt-4o-mini",
      created: 5,
      provider: "openai",
    };
    seedProfile([cachedOpenAi]);
    openAIModelsListMock.mockResolvedValue({ data: [] });

    const result = await fetchModelsForProviders(
      ["openai", "openrouter"],
      { openai: "openai-key", openrouter: "openrouter-key" },
      true,
    );

    expect(result.errors).toEqual({});
    // OpenRouter succeeded, so the merged write happened — OpenAI still survives.
    expect(result.models.map((model) => model.id)).toContain(
      "anthropic/claude-3.5-sonnet",
    );
    expect(result.models).toContainEqual(cachedOpenAi);
    expect(currentModels()).toContainEqual(cachedOpenAi);
  });

  it("keeps a cloud provider's cached slice when its fetch rejects", async () => {
    const cachedOpenAi: Model = {
      id: "gpt-4o-mini",
      name: "gpt-4o-mini",
      created: 5,
      provider: "openai",
    };
    seedProfile([cachedOpenAi]);
    openAIModelsListMock.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await fetchModelsForProviders(
      ["openai", "openrouter"],
      { openai: "revoked-key", openrouter: "openrouter-key" },
      true,
    );

    expect(result.errors.openai).toContain("401 Unauthorized");
    expect(result.models).toContainEqual(cachedOpenAi);
    expect(currentModels()).toContainEqual(cachedOpenAi);
  });

  it("writes nothing when no provider returned any model", async () => {
    const existing: Model[] = [
      { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    seedProfile(existing);
    openAIModelsListMock.mockResolvedValue({ data: [] });
    const setSpy = vi.spyOn(apiStore, "set");

    await fetchModelsForProviders(["openai"], { openai: "openai-key" }, true);

    expect(setSpy).not.toHaveBeenCalled();
    expect(currentModels()).toEqual(existing);
    setSpy.mockRestore();
  });
});
