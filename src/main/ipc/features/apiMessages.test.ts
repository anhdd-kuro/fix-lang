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
 * `connectProvider.test.ts`'s own M1 regression coverage — this file adds
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
  fetchModelsForProvidersMock,
  probeOllamaMock,
  probeLmStudioMock,
  connectProviderToActiveProfileMock,
  disconnectProviderFromActiveProfileMock,
  getCurrentProfileIdMock,
  getProfileSettingMock,
  updateProfileSettingMock,
  resetCurrentProfileSettingsMock,
  hasProfileSecretMock,
  getProfileSecretMock,
  setProfileSecretMock,
  clearProfileSecretMock,
  findRecommendedModelMock,
  checkModelCompatibilityMock,
  setApiKeyMock,
} = vi.hoisted(() => ({
  fetchAvailableModelsMock: vi.fn(),
  fetchModelsForProvidersMock: vi.fn(),
  probeOllamaMock: vi.fn(),
  probeLmStudioMock: vi.fn(),
  connectProviderToActiveProfileMock: vi.fn(),
  disconnectProviderFromActiveProfileMock: vi.fn(),
  getCurrentProfileIdMock: vi.fn().mockReturnValue("profile_1"),
  getProfileSettingMock: vi.fn().mockReturnValue([]),
  updateProfileSettingMock: vi.fn(),
  resetCurrentProfileSettingsMock: vi.fn(),
  hasProfileSecretMock: vi.fn().mockResolvedValue(false),
  getProfileSecretMock: vi.fn().mockResolvedValue(null),
  setProfileSecretMock: vi.fn().mockResolvedValue({ success: true }),
  clearProfileSecretMock: vi.fn().mockResolvedValue({ success: true }),
  findRecommendedModelMock: vi.fn(),
  checkModelCompatibilityMock: vi.fn(),
  setApiKeyMock: vi.fn(),
}));

vi.mock("~/main/ai.request", () => ({
  fetchAvailableModels: fetchAvailableModelsMock,
  fetchModelsForProviders: fetchModelsForProvidersMock,
}));
vi.mock("~/main/llm/models/discover", () => ({ probeOllama: probeOllamaMock }));
vi.mock("~/main/llm/providers/lmstudio/client", () => ({ probeLmStudio: probeLmStudioMock }));
vi.mock("~/main/keybindings", () => ({ reloadHotkeys: vi.fn() }));
vi.mock("~/main/llm", () => ({
  createOllamaClient: () => ({ pull: vi.fn(), delete: vi.fn(), chat: vi.fn() }), ollamaClient: { pull: vi.fn(), delete: vi.fn(), chat: vi.fn() },
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
// No hand-rolled isProviderId/isModelForProvider here: api.ts imports those
// from the unmocked `~/shared/providers`, so the real predicates run.
// `api.ts` calls the profile-bound variants; both names share one mock so the
// active-profile wrappers the real module still exports stay exposed too.
vi.mock("~/stores/apiStore", () => ({
  connectProviderToActiveProfile: connectProviderToActiveProfileMock,
  connectProviderToProfile: connectProviderToActiveProfileMock,
  disconnectProviderFromActiveProfile: disconnectProviderFromActiveProfileMock,
  disconnectProviderFromProfile: disconnectProviderFromActiveProfileMock,
  getCurrentProfileId: getCurrentProfileIdMock,
  getDefaultModelId: vi.fn(),
  getProfileSetting: getProfileSettingMock,
    getProviderEndpoint: () => undefined,
    sanitizeProviderEndpoints: (raw: unknown) => (raw && typeof raw === "object" ? raw : {}),
  resetCurrentProfileSettings: resetCurrentProfileSettingsMock,
  updateProfileSetting: updateProfileSettingMock,
  withoutProfileSecrets: vi.fn((profile: unknown) => profile),
}));
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: { resetKeyBindings: vi.fn() },
}));
vi.mock("~/stores/profileSecretStore", async () => {
  const { PROVIDER_SUPPORTS_API_KEY, PROVIDER_SUPPORTS_PROVISIONING_KEY } =
    await import("~/shared/providers");
  return {
    clearProfileSecret: clearProfileSecretMock,
    getProfileSecret: getProfileSecretMock,
    hasProfileSecret: hasProfileSecretMock,
    setProfileSecret: setProfileSecretMock,
    secretKindsForProvider: (provider: ProviderId) => [
      ...(PROVIDER_SUPPORTS_API_KEY[provider] ? ["api"] : []),
      ...(PROVIDER_SUPPORTS_PROVISIONING_KEY[provider] ? ["provisioning"] : []),
    ],
  };
});

describe("api.ts IPC handlers — app-authored validation errors are translatable Messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    getCurrentProfileIdMock.mockReturnValue("profile_1");
    getProfileSettingMock.mockReturnValue([]);
    hasProfileSecretMock.mockResolvedValue(false);
    getProfileSecretMock.mockResolvedValue(null);
    setProfileSecretMock.mockResolvedValue({ success: true });
    clearProfileSecretMock.mockResolvedValue({ success: true });
    probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });
  probeLmStudioMock.mockResolvedValue({ reachable: true, models: [] });
    fetchModelsForProvidersMock.mockResolvedValue({ models: [], errors: {} });
    connectProviderToActiveProfileMock.mockReturnValue({ id: "profile_1" });
    disconnectProviderFromActiveProfileMock.mockReturnValue(null);
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

  it("fetch-provider-models: an admin key on a provider without that slot is a translatable Message", async () => {
    const handler = handlers.get("fetch-provider-models");
    const result = (await handler?.(undefined, {
      provider: "lmstudio",
      provisioningKey: "sk-x",
    })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.adminKeyUnsupported"));
    expect(ja).toBe(tJa("models.providerSetup.error.adminKeyUnsupported"));
    expect(ja).not.toBe(en);
  });

  it("fetch-provider-models: a missing API key is a translatable, parameterized Message naming the provider", async () => {
    getProfileSecretMock.mockResolvedValue(null);
    const handler = handlers.get("fetch-provider-models");
    const result = (await handler?.(undefined, { provider: "openai" })) as {
      success: boolean;
      error?: unknown;
    };

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

  it("connect-provider: an unparseable payload is a translatable 'Invalid provider setup' Message", async () => {
    const handler = handlers.get("connect-provider");
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

  it("connect-provider: a missing API key is a translatable, parameterized Message naming the provider", async () => {
    getProfileSecretMock.mockResolvedValue(null);
    const handler = handlers.get("connect-provider");
    const result = (await handler?.(undefined, { provider: "openrouter" })) as {
      success: boolean;
      error?: unknown;
    };

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

  it("connect-provider: an unverifiable secret write is a translatable 'API key could not be verified' Message", async () => {
    getProfileSecretMock.mockResolvedValue("sk-abc");
    hasProfileSecretMock.mockResolvedValue(false);
    fetchAvailableModelsMock.mockResolvedValue([
      { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ]);
    const handler = handlers.get("connect-provider");
    // No `apiKey` supplied and `hasProfileSecret` resolves false — the
    // "already verified" branch fails without writing a new secret.
    const result = (await handler?.(undefined, { provider: "openai" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.apiKeyNotVerified"));
    expect(ja).toBe(tJa("models.providerSetup.error.apiKeyNotVerified"));
    expect(ja).not.toBe(en);
  });

  it("connect-provider: a missing active profile after the connect is a translatable Message", async () => {
    getProfileSecretMock.mockResolvedValue("sk-abc");
    hasProfileSecretMock.mockResolvedValue(true);
    fetchAvailableModelsMock.mockResolvedValue([
      { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ]);
    connectProviderToActiveProfileMock.mockReturnValue(null);
    const handler = handlers.get("connect-provider");
    const result = (await handler?.(undefined, { provider: "openai" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.activeProfileNotFound"));
    expect(ja).toBe(tJa("models.providerSetup.error.activeProfileNotFound"));
    expect(ja).not.toBe(en);
  });

  it("connect-provider: an unreachable Ollama daemon is a translatable Message", async () => {
    probeOllamaMock.mockResolvedValue({ reachable: false, models: [], error: "ECONNREFUSED" });
    const handler = handlers.get("connect-provider");
    const result = (await handler?.(undefined, { provider: "ollama" })) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("settings.general.providers.ollama.unreachable"));
    expect(ja).toBe(tJa("settings.general.providers.ollama.unreachable"));
    expect(ja).not.toBe(en);
  });

  it("connect-provider: the reachable-but-empty Ollama note is a translatable Message on a SUCCESS", async () => {
    probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });
    const handler = handlers.get("connect-provider");
    const result = (await handler?.(undefined, { provider: "ollama" })) as {
      success: boolean;
      note?: unknown;
    };

    expect(result.success).toBe(true);
    const { en, ja } = resolveBoth(result.note);
    expect(en).toBe(tEn("settings.general.providers.ollama.noModels"));
    expect(ja).toBe(tJa("settings.general.providers.ollama.noModels"));
    expect(ja).not.toBe(en);
  });

  it("disconnect-provider: an unknown provider is a translatable 'Invalid provider setup' Message", async () => {
    const handler = handlers.get("disconnect-provider");
    const result = (await handler?.(undefined, "bogus")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    const { en, ja } = resolveBoth(result.error);
    expect(en).toBe(tEn("models.providerSetup.error.invalidSetup"));
    expect(ja).toBe(tJa("models.providerSetup.error.invalidSetup"));
    expect(ja).not.toBe(en);
  });

  it("set-selected-model: a model from a provider that is not connected is a translatable Message", async () => {
    getProfileSettingMock.mockImplementation((key: string) =>
      key === "models"
        ? [{ id: "x", name: "x", created: 1, provider: "openrouter" }]
        : ["openai"],
    );
    const handler = handlers.get("set-selected-model");
    const result = (await handler?.(undefined, "openrouter::x")) as {
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
