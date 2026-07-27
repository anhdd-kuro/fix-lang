/**
 * @file model-routing.test.ts
 * @description `makeAIRequest` routes on the provider named by the composite
 * model ref (`<providerId>::<rawId>`), and hands the provider SDK the RAW id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const {
  createOpenAIMock,
  openAIChatMock,
  createOpenRouterMock,
  openRouterModelMock,
  generateTextMock,
  ollamaChatMock,
  getLocalModelsMock,
  getProfileSecretMock,
  showErrorNotificationMock,
} = vi.hoisted(() => {
  const openAIChat = vi.fn(() => ({ provider: "openai" }));
  const openRouterModel = vi.fn(() => ({ provider: "openrouter" }));
  return {
    createOpenAIMock: vi.fn(() => ({ chat: openAIChat })),
    openAIChatMock: openAIChat,
    createOpenRouterMock: vi.fn(() => openRouterModel),
    openRouterModelMock: openRouterModel,
    generateTextMock: vi.fn(),
    ollamaChatMock: vi.fn(),
    getLocalModelsMock: vi.fn(),
    getProfileSecretMock: vi.fn(),
    showErrorNotificationMock: vi.fn(),
  };
});
// Stateful so the real apiStore helpers can read back the seeded profile.
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
vi.mock("~/main/notifications/error", () => ({
  showErrorNotification: showErrorNotificationMock,
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: createOpenRouterMock,
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));
vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("openai", () => ({
  OpenAI: class {
    models = { list: vi.fn().mockResolvedValue({ data: [] }) };
  },
}));
vi.mock("~/stores/apiKeyStore", () => ({
  getApiKey: vi.fn().mockResolvedValue("openrouter-key"),
}));
vi.mock("~/stores/profileSecretStore", () => ({
  getProfileSecret: getProfileSecretMock,
}));
vi.mock("~/main/llm/models/discover", () => ({
  getLocalModels: getLocalModelsMock,
}));
vi.mock("../llm", () => ({ ollamaClient: { chat: ollamaChatMock } }));
import { apiStore } from "~/stores/apiStore";
import * as sharedModule from "./shared";
import { isLocalModelId, makeAIRequest } from "./shared";
import type { Model, Profile, SettingsStore } from "~/stores/apiStore";

const buildSettings = (models: Model[], selectedModel = ""): SettingsStore =>
  ({
    apiKey: "",
    models,
    selectedModel,
    enabledProviders: ["openai", "openrouter", "ollama"],
    customSystemPrompt: "",
    customUserPrompt: "",
    tone: "",
    settingsCorrect: { presets: [], selectedPresetId: "" },
    settingsSummarize: { minLength: 0, maxLength: 0, model: "", targetLanguage: "en" },
    settingsPromptGen: {
      minLength: 50,
      maxLength: 150,
      batchCount: 5,
      nsfw: true,
      context: "",
      autoCopy: false,
      model: "",
    },
    // Via `unknown`: no per-profile fixture sets `profiles`/`currentProfileId`,
    // so a direct `as SettingsStore` is a TS2352 no-overlap error.
  }) as unknown as SettingsStore;

const seed = (models: Model[], selectedModel = ""): void => {
  apiStore.set("profiles", [
    {
      id: "profile_1",
      name: "Test Profile",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      settings: buildSettings(models, selectedModel),
    } as Profile,
  ]);
  apiStore.set("currentProfileId", "profile_1");
};

const openAiModel: Model = {
  id: "gpt-4o",
  name: "gpt-4o",
  created: 1,
  provider: "openai",
};
const openRouterModel: Model = {
  id: "anthropic/claude-3.5-sonnet",
  name: "claude",
  created: 2,
  provider: "openrouter",
};
const ollamaModel: Model = {
  id: "llama3.2:3b",
  name: "llama3.2",
  created: 3,
  provider: "ollama",
  local: { path: "/models/llama3.2" },
};

const request = (model: string) =>
  makeAIRequest({ systemPrompt: "sys", userPrompt: "user", model });

describe("makeAIRequest — ref-based routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed([openAiModel, openRouterModel, ollamaModel]);
    getProfileSecretMock.mockResolvedValue("openai-key");
    getLocalModelsMock.mockResolvedValue([ollamaModel]);
    ollamaChatMock.mockResolvedValue({
      message: { content: "local answer" },
      total_duration: 1,
    });
    generateTextMock.mockResolvedValue({
      text: "answer",
      usage: { promptTokens: 1, completionTokens: 2 },
      response: { body: {} },
    });
  });

  it("an openai:: ref routes to the OpenAI path with the RAW id", async () => {
    const response = await request("openai::gpt-4o");

    expect(createOpenAIMock).toHaveBeenCalledOnce();
    expect(openAIChatMock).toHaveBeenCalledWith("gpt-4o");
    expect(createOpenRouterMock).not.toHaveBeenCalled();
    expect(ollamaChatMock).not.toHaveBeenCalled();
    expect(response.provider).toBe("openai");
    expect(response.model).toBe("gpt-4o");
  });

  it("an openrouter:: ref routes to the OpenRouter path with the RAW id", async () => {
    const response = await request("openrouter::anthropic/claude-3.5-sonnet");

    expect(createOpenRouterMock).toHaveBeenCalledOnce();
    expect(openRouterModelMock).toHaveBeenCalledWith(
      "anthropic/claude-3.5-sonnet",
      expect.anything(),
    );
    expect(createOpenAIMock).not.toHaveBeenCalled();
    expect(response.provider).toBe("openrouter");
    expect(response.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("an ollama:: ref routes to local inference with the RAW tagged id", async () => {
    const response = await request("ollama::llama3.2:3b");

    expect(ollamaChatMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "llama3.2:3b" }),
    );
    expect(createOpenAIMock).not.toHaveBeenCalled();
    expect(createOpenRouterMock).not.toHaveBeenCalled();
    expect(response.provider).toBe("ollama");
    expect(response.model).toBe("llama3.2:3b");
  });

  it("a bare id present in the cache resolves and routes", async () => {
    const response = await request("gpt-4o");

    expect(openAIChatMock).toHaveBeenCalledWith("gpt-4o");
    expect(response.provider).toBe("openai");
  });

  it("routes an ollama-only model correctly even when the profile also holds cloud models", async () => {
    await request("ollama::llama3.2:3b");
    expect(ollamaChatMock).toHaveBeenCalledOnce();
  });

  it("keeps AIRequestResponse.model and resolvedModel raw, never composite", async () => {
    generateTextMock.mockResolvedValue({
      text: "answer",
      usage: { promptTokens: 1, completionTokens: 2 },
      response: { body: { model: "gpt-4o-2024-11-20" } },
    });

    const response = await request("openai::gpt-4o");

    expect(response.model).not.toContain("::");
    expect(response.resolvedModel).toBe("gpt-4o-2024-11-20");
    expect(response.resolvedModel).not.toContain("::");
  });

  it("a prefixed unresolvable ref throws naming both the provider and the model id", async () => {
    await expect(request("openai::ghost-model")).rejects.toThrow(
      /ghost-model/,
    );
    await expect(request("openai::ghost-model")).rejects.toThrow(/OpenAI/);
    expect(showErrorNotificationMock).toHaveBeenCalled();
  });

  it("a bare unresolvable id throws naming the model id and no guessed provider", async () => {
    let message = "";
    await request("ghost-model").catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).toContain("ghost-model");
    // No provider may be interpolated — the ref never named one.
    expect(message).not.toContain("OpenAI");
    expect(message).not.toContain("OpenRouter");
    expect(message).not.toContain("Ollama");
  });

  // The shape every upgrading user has on first launch: a migrated composite
  // `selectedModel` over cached models whose ids are still raw.
  it("a migrated composite selectedModel resolves against raw cached ids", async () => {
    seed([openAiModel, openRouterModel], "openai::gpt-4o");

    // No explicit model: the preset inherits the migrated global default.
    const response = await makeAIRequest({
      systemPrompt: "sys",
      userPrompt: "user",
    });

    expect(openAIChatMock).toHaveBeenCalledWith("gpt-4o");
    expect(response.provider).toBe("openai");
    expect(response.model).toBe("gpt-4o");
  });

  it("the same holds for an OpenRouter profile — the break was provider-agnostic", async () => {
    seed(
      [openRouterModel],
      "openrouter::anthropic/claude-3.5-sonnet",
    );

    const response = await makeAIRequest({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "",
    });

    expect(openRouterModelMock).toHaveBeenCalledWith(
      "anthropic/claude-3.5-sonnet",
      expect.anything(),
    );
    expect(response.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("does not cross-resolve: an openai:: ref for an OpenRouter-only model throws", async () => {
    await expect(request("openai::anthropic/claude-3.5-sonnet")).rejects.toThrow();
    expect(createOpenAIMock).not.toHaveBeenCalled();
  });
});

// A raw id is ambiguous once one cache holds three providers' models, so an
// explicit provider must win over the id scan.
describe("isLocalModelId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed([openAiModel, openRouterModel, ollamaModel]);
  });

  it("is true for any id shape when the provider is known to be ollama", () => {
    expect(isLocalModelId("anything-at-all", "ollama")).toBe(true);
    expect(isLocalModelId("gpt-4o", "ollama")).toBe(true);
    expect(isLocalModelId("local-model", "lmstudio")).toBe(true);
  });

  it("is false when the provider is known and is not ollama, even for a colliding cached local id", () => {
    seed([
      { ...ollamaModel, id: "gpt-4o" },
      openAiModel,
    ]);
    expect(isLocalModelId("gpt-4o", "openai")).toBe(false);
  });

  it("falls back to the cache scan when no provider is supplied", () => {
    expect(isLocalModelId("llama3.2:3b")).toBe(true);
    expect(isLocalModelId("gpt-4o")).toBe(false);
    expect(isLocalModelId(undefined)).toBe(false);
  });
});

describe("getActiveProvider", () => {
  it("no longer exists in src/main/ai.request/shared.ts", () => {
    expect("getActiveProvider" in sharedModule).toBe(false);
  });
});
