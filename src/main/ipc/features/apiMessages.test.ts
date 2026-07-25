/**
 * @file apiMessages.test.ts
 * @description Regression test for the PR #87 review finding: `api.ts` IPC
 * handlers' app-authored validation errors ("Choose a provider…", "API key
 * could not be verified", …) used to be raw English strings the renderer
 * displayed verbatim via `textLabel()`, so they never translated to
 * Japanese. They are now `Message` descriptors (wrapped as a `Label` via
 * `messageLabel()`), resolved at render time.
 *
 * This captures the real handlers registered by `registerApiHandlers` (via a
 * stub `ipcMain.handle`) and invokes them directly, mirroring
 * `applyProviderSetup.test.ts`'s own M1 regression coverage — this file adds
 * the messaging-shape coverage that one doesn't. Expected copy is derived
 * through the real translator kernel (`createTranslator`) — never
 * hand-restated — so a catalog reword can't silently break this file, and an
 * English-fallback regression still fails a test that asserts the JA text.
 *
 * Also covers the boundary decision for handlers whose primary result passes
 * through a store module (`apiStore.ts`) outside this migration's scope —
 * `reset-profile-settings` wraps that pass-through error as an opaque
 * `textLabel` rather than guessing at translatability.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLabel, resolveLabel } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
// `registerApiHandlers` (registers the real handlers into `handlers`) and the
// `vi.mock(...)` calls below are both hoisted by Vitest's transform to the
// top of the module regardless of source position, so this import safely
// resolves against the mocked modules despite appearing before them here —
// matching import/order's required group placement (relative import before
// the trailing `type`-only group).
import { registerApiHandlers } from "./api";
import type { Label } from "~/shared/i18n/message";

const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const resolveBoth = (label: unknown): { en: string; ja: string } => {
  expect(isLabel(label)).toBe(true);
  return {
    en: resolveLabel(label as Label, tEn),
    ja: resolveLabel(label as Label, tJa),
  };
};

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
    handlers.set(channel, listener);
  }, on: vi.fn() },
}));

const {
  fetchAvailableModelsMock,
  commitActiveProfileProviderSetupMock,
  getCurrentProfileIdMock,
  getProfileSettingMock,
  getActiveProviderMock,
  updateProfileSettingMock,
  resetCurrentProfileSettingsMock,
  hasProfileSecretMock,
  getProfileSecretMock,
  setProfileSecretMock,
  findRecommendedModelMock,
  checkModelCompatibilityMock,
  setApiKeyMock,
} = vi.hoisted(() => ({
  fetchAvailableModelsMock: vi.fn(),
  commitActiveProfileProviderSetupMock: vi.fn(),
  getCurrentProfileIdMock: vi.fn().mockReturnValue("profile_1"),
  getProfileSettingMock: vi.fn().mockReturnValue([]),
  getActiveProviderMock: vi.fn().mockReturnValue("openai"),
  updateProfileSettingMock: vi.fn(),
  resetCurrentProfileSettingsMock: vi.fn(),
  hasProfileSecretMock: vi.fn().mockResolvedValue(false),
  getProfileSecretMock: vi.fn().mockResolvedValue(null),
  setProfileSecretMock: vi.fn().mockResolvedValue({ success: true }),
  findRecommendedModelMock: vi.fn(),
  checkModelCompatibilityMock: vi.fn(),
  setApiKeyMock: vi.fn(),
}));

vi.mock("~/main/ai.request", () => ({
  fetchAvailableModels: fetchAvailableModelsMock,
  fetchModelsForDisplay: vi.fn(),
  getActiveProvider: getActiveProviderMock,
}));
vi.mock("~/main/keybindings", () => ({ reloadHotkeys: vi.fn() }));
vi.mock("~/main/llm", () => ({
  ollamaClient: { pull: vi.fn(), delete: vi.fn(), chat: vi.fn() },
}));
vi.mock("~/main/llm/models/compatibility", () => ({
  checkModelCompatibility: checkModelCompatibilityMock,
}));
vi.mock("~/main/llm/models/recommended", () => ({
  findRecommendedModel: findRecommendedModelMock,
  getRecommendedModels: vi.fn(),
}));
vi.mock("~/stores/apiKeyStore", () => ({
  clearApiKey: vi.fn(),
  getApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: setApiKeyMock,
}));
vi.mock("~/stores/apiStore", () => ({
  isProviderId: (value: unknown): boolean =>
    value === "openai" || value === "openrouter" || value === "ollama",
  isModelForProvider: (
    model: { provider?: string; local?: unknown },
    provider: string,
  ): boolean =>
    provider === "ollama"
      ? model.provider === "ollama" || model.local !== undefined
      : model.provider === provider ||
        (provider === "openrouter" && model.provider === undefined && !model.local),
  commitActiveProfileProviderSetup: commitActiveProfileProviderSetupMock,
  getCurrentProfileId: getCurrentProfileIdMock,
  getDefaultModelId: vi.fn(),
  getProfileSetting: getProfileSettingMock,
  resetCurrentProfileSettings: resetCurrentProfileSettingsMock,
  updateProfileSetting: updateProfileSettingMock,
}));
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: { resetKeyBindings: vi.fn() },
}));
vi.mock("~/stores/profileSecretStore", () => ({
  getProfileSecret: getProfileSecretMock,
  hasProfileSecret: hasProfileSecretMock,
  setProfileSecret: setProfileSecretMock,
}));

describe("api.ts IPC handlers — app-authored validation errors are translatable Messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    getCurrentProfileIdMock.mockReturnValue("profile_1");
    getActiveProviderMock.mockReturnValue("openai");
    getProfileSettingMock.mockReturnValue([]);
    hasProfileSecretMock.mockResolvedValue(false);
    getProfileSecretMock.mockResolvedValue(null);
    setProfileSecretMock.mockResolvedValue({ success: true });
    registerApiHandlers();
  });

  it("set-api-key: a non-string key is a translatable 'Invalid key' Message", async () => {
    const handler = handlers.get("set-api-key");
    const result = (await handler?.(undefined, 42)) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.invalidApiKeyInput"));
    expect(ja).toBe(tJa("models.providerSetup.error.invalidApiKeyInput"));
    expect(ja).not.toBe(en);
  });

  it("fetch-provider-models: an unparseable payload is a translatable 'Invalid provider setup' Message", async () => {
    const handler = handlers.get("fetch-provider-models");
    const result = (await handler?.(undefined, { provider: "bogus" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.invalidSetup"));
    expect(ja).toBe(tJa("models.providerSetup.error.invalidSetup"));
    expect(ja).not.toBe(en);
  });

  it("fetch-provider-models: a provisioning key on a non-OpenRouter provider is a translatable Message", async () => {
    const handler = handlers.get("fetch-provider-models");
    const result = (await handler?.(undefined, {
      provider: "openai",
      modelId: "gpt-4o",
      provisioningKey: "sk-or-x",
    })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.provisioningKeyOpenRouterOnly"));
    expect(ja).toBe(tJa("models.providerSetup.error.provisioningKeyOpenRouterOnly"));
    expect(ja).not.toBe(en);
  });

  it("fetch-provider-models: a missing API key is a translatable, parameterized Message naming the provider", async () => {
    getProfileSecretMock.mockResolvedValue(null);
    const handler = handlers.get("fetch-provider-models");
    const result = (await handler?.(undefined, {
      provider: "openai",
      modelId: "gpt-4o",
    })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(
      tEn("models.providerSetup.error.apiKeyRequiredFirst", { provider: "OpenAI" }),
    );
    expect(ja).toBe(
      tJa("models.providerSetup.error.apiKeyRequiredFirst", { provider: "OpenAI" }),
    );
    expect(ja).not.toBe(en);
  });

  it("apply-provider-setup: a missing profile/modelId is a translatable 'Choose a provider and default model' Message", async () => {
    const handler = handlers.get("apply-provider-setup");
    const result = (await handler?.(undefined, { provider: "openai" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.chooseProviderAndModel"));
    expect(ja).toBe(tJa("models.providerSetup.error.chooseProviderAndModel"));
    expect(ja).not.toBe(en);
  });

  it("apply-provider-setup: a missing API key is a translatable, parameterized Message naming the provider", async () => {
    getProfileSecretMock.mockResolvedValue(null);
    const handler = handlers.get("apply-provider-setup");
    const result = (await handler?.(undefined, {
      provider: "openrouter",
      modelId: "anthropic/claude-3",
    })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(
      tEn("models.providerSetup.error.apiKeyRequired", { provider: "OpenRouter" }),
    );
    expect(ja).toBe(
      tJa("models.providerSetup.error.apiKeyRequired", { provider: "OpenRouter" }),
    );
    expect(ja).not.toBe(en);
  });

  it("apply-provider-setup: a model absent from the fetched list is a translatable Message", async () => {
    getProfileSecretMock.mockResolvedValue("sk-abc");
    fetchAvailableModelsMock.mockResolvedValue([
      { id: "openai/other-model", name: "other", created: 1, provider: "openai" },
    ]);
    const handler = handlers.get("apply-provider-setup");
    const result = (await handler?.(undefined, {
      provider: "openai",
      modelId: "openai/gpt-4o",
    })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.chooseModelForProvider"));
    expect(ja).toBe(tJa("models.providerSetup.error.chooseModelForProvider"));
    expect(ja).not.toBe(en);
  });

  it("apply-provider-setup: an unverifiable secret write is a translatable 'API key could not be verified' Message", async () => {
    getProfileSecretMock.mockResolvedValue("sk-abc");
    hasProfileSecretMock.mockResolvedValue(false);
    fetchAvailableModelsMock.mockResolvedValue([
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ]);
    const handler = handlers.get("apply-provider-setup");
    // No `apiKey` supplied and `hasProfileSecret` resolves false — the
    // "already verified" branch fails without writing a new secret.
    const result = (await handler?.(undefined, {
      provider: "openai",
      modelId: "openai/gpt-4o",
    })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.apiKeyNotVerified"));
    expect(ja).toBe(tJa("models.providerSetup.error.apiKeyNotVerified"));
    expect(ja).not.toBe(en);
  });

  it("apply-provider-setup: a missing active profile after commit is a translatable Message", async () => {
    getProfileSecretMock.mockResolvedValue("sk-abc");
    hasProfileSecretMock.mockResolvedValue(true);
    fetchAvailableModelsMock.mockResolvedValue([
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ]);
    commitActiveProfileProviderSetupMock.mockReturnValue(null);
    const handler = handlers.get("apply-provider-setup");
    const result = (await handler?.(undefined, {
      provider: "openai",
      modelId: "openai/gpt-4o",
    })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.activeProfileNotFound"));
    expect(ja).toBe(tJa("models.providerSetup.error.activeProfileNotFound"));
    expect(ja).not.toBe(en);
  });

  it("set-selected-model: a model unavailable from the active provider is a translatable Message", async () => {
    getProfileSettingMock.mockReturnValue([
      { id: "openrouter/x", name: "x", provider: "openrouter" },
    ]);
    getActiveProviderMock.mockReturnValue("openai");
    const handler = handlers.get("set-selected-model");
    const result = (await handler?.(undefined, "openrouter/x")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.select.error.modelNotAvailableForProvider"));
    expect(ja).toBe(tJa("models.select.error.modelNotAvailableForProvider"));
    expect(ja).not.toBe(en);
  });

  it("set-feature-model: an unsupported feature is a translatable Message", async () => {
    const handler = handlers.get("set-feature-model");
    const result = (await handler?.(undefined, "notAFeature", "model-x")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.select.error.unsupportedFeatureModel"));
    expect(ja).toBe(tJa("models.select.error.unsupportedFeatureModel"));
    expect(ja).not.toBe(en);
  });

  it("check-model-compatibility: an unknown model is a translatable, parameterized Message", async () => {
    findRecommendedModelMock.mockReturnValue(undefined);
    const handler = handlers.get("check-model-compatibility");
    const result = (await handler?.(undefined, "no-such-model")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(
      tEn("models.manager.error.modelNotFound", { modelName: "no-such-model" }),
    );
    expect(ja).toBe(
      tJa("models.manager.error.modelNotFound", { modelName: "no-such-model" }),
    );
    expect(ja).not.toBe(en);
  });

  it("reset-profile-settings: a store-authored error (apiStore.ts, outside this migration's scope) is boundary-wrapped as opaque and stays identical across locales", async () => {
    // `resetCurrentProfileSettings` (apiStore.ts) is out of scope for this
    // migration — its error text is boundary-wrapped as an opaque
    // `textLabel` by `wrapStoreResult`, never guessed at as translatable.
    resetCurrentProfileSettingsMock.mockReturnValue({
      success: false,
      error: "Active profile not found",
    });
    const handler = handlers.get("reset-profile-settings");
    const result = (await handler?.(undefined)) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "Active profile not found" });
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe("Active profile not found");
    expect(ja).toBe("Active profile not found");
  });
});
