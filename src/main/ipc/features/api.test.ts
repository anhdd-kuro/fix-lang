/**
 * @file api.test.ts
 * @description Validation unit tests for the staged provider-setup payload
 * parser (`parseProviderSetup`). Pure input-shape rejection tests — no
 * Electron IPC is exercised (`registerApiHandlers` is never called), so every
 * heavy dependency the module imports is mocked at the module boundary.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("~/main/ai.request", () => ({
  fetchAvailableModels: vi.fn(),
  getActiveProvider: vi.fn(),
}));
vi.mock("~/main/keybindings", () => ({
  reloadHotkeys: vi.fn(),
}));
vi.mock("~/main/llm", () => ({
  ollamaClient: { pull: vi.fn(), delete: vi.fn(), chat: vi.fn() },
}));
vi.mock("~/main/llm/models/compatibility", () => ({
  checkModelCompatibility: vi.fn(),
}));
vi.mock("~/main/llm/models/recommended", () => ({
  findRecommendedModel: vi.fn(),
  getRecommendedModels: vi.fn(),
}));
vi.mock("~/stores/apiKeyStore", () => ({
  clearApiKey: vi.fn(),
  getApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
}));
// Only isProviderId needs real-ish behavior — parseProviderSetup's validation
// depends on it directly. Everything else the module imports is a plain mock.
vi.mock("~/stores/apiStore", () => ({
  isProviderId: (value: unknown): boolean =>
    value === "openai" || value === "openrouter" || value === "ollama",
  commitActiveProfileProviderSetup: vi.fn(),
  getCurrentProfileId: vi.fn(),
  getDefaultModelId: vi.fn(),
  getProfileSetting: vi.fn(),
  isModelForProvider: vi.fn(),
  resetCurrentProfileSettings: vi.fn(),
  updateProfileSetting: vi.fn(),
}));
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: { resetKeyBindings: vi.fn() },
}));
vi.mock("~/stores/profileSecretStore", () => ({
  getProfileSecret: vi.fn(),
  hasProfileSecret: vi.fn(),
  setProfileSecret: vi.fn(),
}));
// Import (after mocks) — the real function under test.
import { parseProviderSetup } from "./api";

describe("parseProviderSetup", () => {
  it("accepts a minimal valid payload", () => {
    expect(parseProviderSetup({ provider: "openai", modelId: "gpt-4o" })).toEqual({
      provider: "openai",
      modelId: "gpt-4o",
    });
  });

  it("accepts a full payload with apiKey and provisioningKey", () => {
    expect(
      parseProviderSetup({
        provider: "openrouter",
        modelId: "anthropic/claude-3",
        apiKey: "sk-or-abc",
        provisioningKey: "sk-or-prov",
      }),
    ).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-3",
      apiKey: "sk-or-abc",
      provisioningKey: "sk-or-prov",
    });
  });

  it("trims the modelId", () => {
    expect(parseProviderSetup({ provider: "ollama", modelId: "  llama3  " })).toEqual({
      provider: "ollama",
      modelId: "llama3",
    });
  });

  it("rejects a non-object payload", () => {
    expect(parseProviderSetup(null)).toBeNull();
    expect(parseProviderSetup(undefined)).toBeNull();
    expect(parseProviderSetup("openai")).toBeNull();
    expect(parseProviderSetup(42)).toBeNull();
  });

  it("rejects a bad/unknown provider", () => {
    expect(parseProviderSetup({ provider: "anthropic", modelId: "gpt-4o" })).toBeNull();
    expect(parseProviderSetup({ provider: "", modelId: "gpt-4o" })).toBeNull();
    expect(parseProviderSetup({ modelId: "gpt-4o" })).toBeNull();
  });

  it("rejects a non-string modelId", () => {
    expect(parseProviderSetup({ provider: "openai", modelId: 123 })).toBeNull();
    expect(parseProviderSetup({ provider: "openai", modelId: null })).toBeNull();
    expect(parseProviderSetup({ provider: "openai" })).toBeNull();
  });

  it("rejects a non-string apiKey", () => {
    expect(
      parseProviderSetup({ provider: "openai", modelId: "gpt-4o", apiKey: 123 }),
    ).toBeNull();
  });

  it("rejects a non-string provisioningKey", () => {
    expect(
      parseProviderSetup({
        provider: "openrouter",
        modelId: "gpt-4o",
        provisioningKey: {},
      }),
    ).toBeNull();
  });
});
