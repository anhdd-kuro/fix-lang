/**
 * @file api.test.ts
 * @description Validation unit tests for the provider-connect payload parser
 * (`parseProviderConnect`). Pure input-shape rejection tests — no Electron IPC
 * is exercised (`registerApiHandlers` is never called), so every heavy
 * dependency the module imports is mocked at the module boundary, except
 * `~/features/providers/shared/providers` — a stand-in for `isProviderId` would test the stand-in.
 */
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_IDS } from "~/features/providers/shared/providers";
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("~/main/ai.request", () => ({
  fetchAvailableModels: vi.fn(),
  fetchModelsForProviders: vi.fn(),
}));
vi.mock("~/main/keybindings", () => ({
  reloadHotkeys: vi.fn(),
}));
vi.mock("~/main/llm", () => ({
  createOllamaClient: () => ({ pull: vi.fn(), delete: vi.fn(), chat: vi.fn() }), ollamaClient: { pull: vi.fn(), delete: vi.fn(), chat: vi.fn() },
}));
vi.mock("~/main/llm/models/compatibility", () => ({
  checkModelCompatibility: vi.fn(),
}));
vi.mock("~/main/llm/models/discover", () => ({
  probeOllama: vi.fn(),
  probeLmStudio: vi.fn(),
}));
vi.mock("~/main/llm/models/recommended", () => ({
  findRecommendedModel: vi.fn(),
  getRecommendedModels: vi.fn(),
}));
vi.mock("~/features/providers/store/apiKeyStore", () => ({
  clearApiKey: vi.fn(),
  getApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  connectProviderToActiveProfile: vi.fn(),
  connectProviderToProfile: vi.fn(),
  disconnectProviderFromActiveProfile: vi.fn(),
  disconnectProviderFromProfile: vi.fn(),
  getCurrentProfileId: vi.fn(),
  getDefaultModelId: vi.fn(),
  getProfileSetting: vi.fn(),
  resetCurrentProfileSettings: vi.fn(),
  updateProfileSetting: vi.fn(),
  withoutProfileSecrets: vi.fn((profile: unknown) => profile),
}));
vi.mock("~/features/correction/store/keybindingStore", () => ({
  keybindingStore: { resetKeyBindings: vi.fn() },
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  clearProfileSecret: vi.fn(),
  getProfileSecret: vi.fn(),
  hasProfileSecret: vi.fn(),
  secretKindsForProvider: vi.fn().mockReturnValue([]),
  setProfileSecret: vi.fn(),
}));
// Import (after mocks) — the real function under test.
import { parseProviderConnect } from "./api";

describe("parseProviderConnect", () => {
  it("accepts a bare provider — no modelId is required or carried", () => {
    expect(parseProviderConnect({ provider: "openai" })).toEqual({ provider: "openai" });
  });

  it("accepts a full payload with apiKey and provisioningKey", () => {
    expect(
      parseProviderConnect({
        provider: "openrouter",
        apiKey: "sk-or-abc",
        provisioningKey: "sk-or-prov",
      }),
    ).toEqual({
      provider: "openrouter",
      apiKey: "sk-or-abc",
      provisioningKey: "sk-or-prov",
    });
  });

  it("DROPS a modelId a stale caller still sends", () => {
    const parsed = parseProviderConnect({ provider: "ollama", modelId: "llama3" });

    expect(parsed).toEqual({ provider: "ollama" });
    expect(parsed).not.toHaveProperty("modelId");
  });

  it("rejects a non-object payload", () => {
    expect(parseProviderConnect(null)).toBeNull();
    expect(parseProviderConnect(undefined)).toBeNull();
    expect(parseProviderConnect("openai")).toBeNull();
    expect(parseProviderConnect(42)).toBeNull();
  });

  it("rejects a bad/unknown provider", () => {
    expect(parseProviderConnect({ provider: "anthropic" })).toBeNull();
    expect(parseProviderConnect({ provider: "" })).toBeNull();
    expect(parseProviderConnect({})).toBeNull();
  });

  it("rejects a provider carried on the prototype rather than the object", () => {
    expect(parseProviderConnect({ provider: "constructor" })).toBeNull();
    expect(parseProviderConnect({ provider: "toString" })).toBeNull();
  });

  it("rejects a non-string apiKey", () => {
    expect(parseProviderConnect({ provider: "openai", apiKey: 123 })).toBeNull();
    expect(parseProviderConnect({ provider: "openai", apiKey: null })).toBeNull();
  });

  it("rejects a non-string provisioningKey", () => {
    expect(
      parseProviderConnect({ provider: "openrouter", provisioningKey: {} }),
    ).toBeNull();
  });

  it("accepts every provider id, derived from the registry rather than listed", () => {
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
    for (const provider of PROVIDER_IDS) {
      expect(parseProviderConnect({ provider })).toEqual({ provider });
    }
  });
});
