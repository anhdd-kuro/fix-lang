/**
 * @file connectProvider.test.ts
 * @description The `connect-provider` handler. Captures the real handlers
 * registered by `registerApiHandlers` (via a stub `ipcMain.handle`) and
 * invokes them directly.
 *
 * `~/shared/providers` and `~/shared/modelRef` are deliberately NOT mocked — a
 * hand-written stand-in for the predicate under refactor tests the stand-in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLabel } from "~/shared/i18n/message";
const {
  fetchAvailableModelsMock,
  fetchModelsForProvidersMock,
  probeOllamaMock,
  probeLmStudioMock,
  connectProviderToActiveProfileMock,
  connectProviderToProfileMock,
  disconnectProviderFromActiveProfileMock,
  disconnectProviderFromProfileMock,
  getCurrentProfileIdMock,
  getProfileSettingMock,
  updateProfileSettingMock,
  getProfileSecretMock,
  hasProfileSecretMock,
  setProfileSecretMock,
  clearProfileSecretMock,
  withoutProfileSecretsMock,
} = vi.hoisted(() => ({
  fetchAvailableModelsMock: vi.fn(),
  fetchModelsForProvidersMock: vi.fn(),
  probeOllamaMock: vi.fn(),
  probeLmStudioMock: vi.fn(),
  connectProviderToActiveProfileMock: vi.fn(),
  connectProviderToProfileMock: vi.fn(),
  disconnectProviderFromActiveProfileMock: vi.fn(),
  disconnectProviderFromProfileMock: vi.fn(),
  getCurrentProfileIdMock: vi.fn(),
  getProfileSettingMock: vi.fn(),
  updateProfileSettingMock: vi.fn(),
  getProfileSecretMock: vi.fn(),
  hasProfileSecretMock: vi.fn(),
  setProfileSecretMock: vi.fn(),
  clearProfileSecretMock: vi.fn(),
  withoutProfileSecretsMock: vi.fn(),
}));
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    on: vi.fn(),
  },
}));
vi.mock("~/main/ai.request", () => ({
  fetchAvailableModels: fetchAvailableModelsMock,
  fetchModelsForProviders: fetchModelsForProvidersMock,
}));
vi.mock("~/main/keybindings", () => ({ reloadHotkeys: vi.fn() }));
vi.mock("~/main/llm", () => ({
  ollamaClient: { pull: vi.fn(), delete: vi.fn(), chat: vi.fn() },
}));
vi.mock("~/main/llm/models/compatibility", () => ({
  checkModelCompatibility: vi.fn(),
}));
vi.mock("~/main/llm/models/discover", () => ({ probeOllama: probeOllamaMock }));
vi.mock("~/main/llm/providers/lmstudio/client", () => ({ probeLmStudio: probeLmStudioMock }));
vi.mock("~/main/llm/models/recommended", () => ({
  findRecommendedModel: vi.fn(),
  getRecommendedModels: vi.fn(),
}));
vi.mock("~/stores/apiKeyStore", () => ({
  clearApiKey: vi.fn(),
  getApiKey: vi.fn().mockResolvedValue(null),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
}));
vi.mock("~/stores/apiStore", () => ({
  connectProviderToActiveProfile: connectProviderToActiveProfileMock,
  connectProviderToProfile: connectProviderToProfileMock,
  disconnectProviderFromActiveProfile: disconnectProviderFromActiveProfileMock,
  disconnectProviderFromProfile: disconnectProviderFromProfileMock,
  getCurrentProfileId: getCurrentProfileIdMock,
  getDefaultModelId: vi.fn(),
  getProfileSetting: getProfileSettingMock,
    getProviderEndpoint: () => undefined,
    sanitizeProviderEndpoints: (raw: unknown) => (raw && typeof raw === "object" ? raw : {}),
  resetCurrentProfileSettings: vi.fn(),
  updateProfileSetting: updateProfileSettingMock,
  withoutProfileSecrets: withoutProfileSecretsMock,
}));
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: { resetKeyBindings: vi.fn() },
}));
// `profileSecretStore` reaches `app.getPath` at import, so it cannot be
// `importActual`'d. `secretKindsForProvider` derives from the real provider
// tables so a fourth provider inherits the right slots here too.
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
// Import (after mocks) — registers the real handlers into the `handlers` map.
import { registerApiHandlers } from "./api";
import type { Model, ProviderId } from "~/shared/providers";

const OPENAI_MODEL: Model = {
  id: "gpt-4o",
  name: "gpt-4o",
  created: 1,
  provider: "openai",
};

/** Distinguishable so a handler returning the RAW profile is visible. */
const STRIPPED_PROFILE = { id: "profile_1", strippedBy: "withoutProfileSecrets" };
const RAW_PROFILE = {
  id: "profile_1",
  settings: { apiKey: "sk-plaintext-legacy-not-yet-migrated" },
};
type HandlerResult = {
  success: boolean;
  error?: unknown;
  note?: unknown;
  profile?: unknown;
};

const connect = async (payload: unknown): Promise<HandlerResult> =>
  (await handlers.get("connect-provider")?.(undefined, payload)) as HandlerResult;

beforeEach(() => {
  // vi.clearAllMocks() clears calls but not return values, so a value set by
  // one test would otherwise leak into every later one.
  vi.clearAllMocks();
  handlers.clear();
  fetchAvailableModelsMock.mockResolvedValue([OPENAI_MODEL]);
  fetchModelsForProvidersMock.mockResolvedValue({ models: [], errors: {} });
  probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });
  probeLmStudioMock.mockResolvedValue({ reachable: true, models: [] });
  connectProviderToActiveProfileMock.mockReturnValue({ id: "profile_1" });
  connectProviderToProfileMock.mockReturnValue({ id: "profile_1" });
  disconnectProviderFromActiveProfileMock.mockReturnValue(null);
  disconnectProviderFromProfileMock.mockReturnValue(null);
  getCurrentProfileIdMock.mockReturnValue("profile_1");
  getProfileSettingMock.mockReturnValue([]);
  updateProfileSettingMock.mockReturnValue({ success: true });
  getProfileSecretMock.mockResolvedValue(null);
  hasProfileSecretMock.mockResolvedValue(false);
  setProfileSecretMock.mockResolvedValue({ success: true });
  clearProfileSecretMock.mockResolvedValue({ success: true });
  withoutProfileSecretsMock.mockImplementation(() => STRIPPED_PROFILE);
  registerApiHandlers();
});

describe("the registered channel set", () => {
  it("does not register get-active-provider anywhere", () => {
    expect(handlers.has("get-active-provider")).toBe(false);
    expect([...handlers.keys()]).not.toContain("get-active-provider");
  });

  it("does not register the old apply-provider-setup channel", () => {
    expect(handlers.has("apply-provider-setup")).toBe(false);
  });

  it("registers connect-provider, disconnect-provider and get-provider-states", () => {
    expect(handlers.get("connect-provider")).toBeTypeOf("function");
    expect(handlers.get("disconnect-provider")).toBeTypeOf("function");
    expect(handlers.get("get-provider-states")).toBeTypeOf("function");
  });
});

describe("connect-provider — payload validation", () => {
  it("rejects an unknown provider without fetching or connecting", async () => {
    const result = await connect({ provider: "anthropic" });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.invalidSetup" },
    });
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a non-object payload", async () => {
    for (const payload of [null, undefined, "openai", 42]) {
      const result = await connect(payload);
      expect(result.success).toBe(false);
    }
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });

  it("rejects an admin key on a provider that has no admin slot", async () => {
    const result = await connect({
      provider: "lmstudio",
      provisioningKey: "sk-prov",
    });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.adminKeyUnsupported" },
    });
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });

  it("stores an admin key against the provider that was connected, never OpenRouter's slot", async () => {
    const result = await connect({
      provider: "openai",
      apiKey: "sk-abc",
      provisioningKey: "sk-admin-abc",
    });

    expect(result.success).toBe(true);
    expect(setProfileSecretMock).toHaveBeenCalledWith(
      expect.any(String),
      "openai",
      "provisioning",
      "sk-admin-abc",
    );
  });

  it("refuses an OpenAI admin key pasted into OpenRouter's admin field", async () => {
    // The reported bug: this used to store, report "Key set", and then fail
    // every OpenRouter account read with an unexplained 401.
    const result = await connect({
      provider: "openrouter",
      apiKey: "sk-or-abc",
      provisioningKey: "sk-admin-abc",
    });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: {
        key: "models.providerSetup.error.adminKeyShapeMismatch",
        params: { provider: "OpenRouter", expected: "sk-or-v1-" },
      },
    });
    // Refused BEFORE the write and before the provider round-trip: a key in the
    // wrong slot must not be spent on a request either.
    expect(setProfileSecretMock).not.toHaveBeenCalled();
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });

  it("refuses an OpenRouter key pasted into either OpenAI field", async () => {
    expect((await connect({ provider: "openai", apiKey: "sk-or-abc" })).success).toBe(
      false,
    );
    expect(
      (
        await connect({
          provider: "openai",
          apiKey: "sk-proj-abc",
          provisioningKey: "sk-or-abc",
        })
      ).success,
    ).toBe(false);
    expect(setProfileSecretMock).not.toHaveBeenCalled();
  });

  it("rejects a missing key for a key-requiring provider", async () => {
    getProfileSecretMock.mockResolvedValue(null);

    const result = await connect({ provider: "openai" });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: {
        key: "models.providerSetup.error.apiKeyRequired",
        params: { provider: "OpenAI" },
      },
    });
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });

  it("does NOT require a key for ollama", async () => {
    probeOllamaMock.mockResolvedValue({
      reachable: true,
      models: [{ id: "llama3.2:3b", name: "llama3.2", created: 1, provider: "ollama" }],
    });

    const result = await connect({ provider: "ollama" });

    expect(result.success).toBe(true);
    expect(getProfileSecretMock).not.toHaveBeenCalled();
    expect(setProfileSecretMock).not.toHaveBeenCalled();
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
    expect(connectProviderToProfileMock).toHaveBeenCalledWith("profile_1", "ollama", [
      { id: "llama3.2:3b", name: "llama3.2", created: 1, provider: "ollama" },
    ]);
  });
});

describe("connect-provider — M1: a stale key must fail, not pass via the cache", () => {
  it("fails when the live fetch throws, even though the provider has cached models", async () => {
    // Cached models from an earlier successful connect are what let a stale
    // key silently "pass" before the fix.
    getProfileSecretMock.mockResolvedValue("sk-stale-revoked-key");
    getProfileSettingMock.mockReturnValue([OPENAI_MODEL]);
    fetchAvailableModelsMock.mockImplementation(
      async (_key: string, _provider: string, _persist: boolean, strict?: boolean) => {
        if (strict) throw new Error("401 Unauthorized");
        return [OPENAI_MODEL];
      },
    );

    const result = await connect({ provider: "openai" });

    expect(result.success).toBe(false);
    expect(isLabel(result.error)).toBe(true);
    expect(result.error).toEqual({ kind: "text", text: "401 Unauthorized" });
    expect(fetchAvailableModelsMock).toHaveBeenCalledWith(
      "sk-stale-revoked-key",
      "openai",
      false,
      true,
    );
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
    expect(setProfileSecretMock).not.toHaveBeenCalled();
  });

  it("succeeds when the live fetch resolves (control case)", async () => {
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);

    const result = await connect({ provider: "openai" });

    expect(result.success).toBe(true);
    expect(connectProviderToProfileMock).toHaveBeenCalledWith("profile_1", "openai", [
      OPENAI_MODEL,
    ]);
  });

  it("stores a newly supplied key only AFTER the live fetch validated it", async () => {
    const result = await connect({ provider: "openai", apiKey: "sk-new" });

    expect(result.success).toBe(true);
    expect(setProfileSecretMock).toHaveBeenCalledWith("profile_1", "openai", "api", "sk-new");
    expect(fetchAvailableModelsMock).toHaveBeenCalledWith("sk-new", "openai", false, true);
    // ORDER, not just "both happened": kills a write moved above the fetch.
    expect(setProfileSecretMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      fetchAvailableModelsMock.mock.invocationCallOrder[0],
    );
  });

  it("never persists a SUPPLIED key that the live fetch rejected", async () => {
    // Drives the typed-key path the M1 test above skips: a pasted typo must
    // not land on disk over a working key.
    fetchAvailableModelsMock.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await connect({ provider: "openai", apiKey: "sk-typo" });

    expect(result.success).toBe(false);
    expect(setProfileSecretMock).not.toHaveBeenCalled();
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });
});

describe("connect-provider is bound to the profile whose key it stored", () => {
  // Two profiles behind both store entry points, each faked the way apiStore.ts
  // implements it: the bound variant writes to the id it is handed, the active
  // variant re-resolves the current profile at call time.
  const seedTwoProfiles = (): Map<string, Model[]> => {
    const models = new Map<string, Model[]>([
      ["profile_1", []],
      ["profile_2", []],
    ]);
    const apply = (profileId: string, _provider: string, connected: Model[]) => {
      if (!models.has(profileId)) return null;
      models.set(profileId, connected);
      return { id: profileId };
    };
    connectProviderToProfileMock.mockImplementation(apply);
    connectProviderToActiveProfileMock.mockImplementation(
      (provider: string, connected: Model[]) =>
        apply(getCurrentProfileIdMock() as string, provider, connected),
    );
    return models;
  };

  it("connects the originating profile when a hotkey switches profiles during the fetch", async () => {
    const models = seedTwoProfiles();
    // Ctrl+Shift+P landing while the model fetch is still in flight.
    fetchAvailableModelsMock.mockImplementation(async () => {
      getCurrentProfileIdMock.mockReturnValue("profile_2");
      return [OPENAI_MODEL];
    });

    const result = await connect({ provider: "openai", apiKey: "sk-new" });

    expect(result.success).toBe(true);
    expect(setProfileSecretMock).toHaveBeenCalledWith("profile_1", "openai", "api", "sk-new");
    expect(models.get("profile_1")).toEqual([OPENAI_MODEL]);
    // profile_2 never gets a slice it has no key for.
    expect(models.get("profile_2")).toEqual([]);
  });

  it("fails without connecting anything when the originating profile is gone", async () => {
    const models = seedTwoProfiles();
    fetchAvailableModelsMock.mockImplementation(async () => {
      models.delete("profile_1");
      getCurrentProfileIdMock.mockReturnValue("profile_2");
      return [OPENAI_MODEL];
    });

    const result = await connect({ provider: "openai", apiKey: "sk-new" });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.activeProfileNotFound" },
    });
    expect(models.get("profile_2")).toEqual([]);
  });
});

describe("connect-provider — what crosses back to the renderer", () => {
  it("returns the SECRET-STRIPPED profile, never the raw one", async () => {
    // SECURITY: `SettingsStore` still declares the deprecated plaintext
    // `apiKey`, so the raw profile would hand the renderer a decrypted key.
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);
    connectProviderToProfileMock.mockReturnValue(RAW_PROFILE);

    const result = await connect({ provider: "openai" });

    expect(withoutProfileSecretsMock).toHaveBeenCalledWith(RAW_PROFILE);
    expect(result.profile).toBe(STRIPPED_PROFILE);
    expect(JSON.stringify(result)).not.toContain("sk-plaintext-legacy");
  });

  it("redacts a provider error that quotes the key back", async () => {
    // SECURITY: OpenAI's 401 body echoes a prefix AND suffix of the stored
    // key, which the renderer never typed. Neither half may cross.
    getProfileSecretMock.mockResolvedValue("sk-proj-abcdefgh12345678WXYZ");
    fetchAvailableModelsMock.mockRejectedValue(
      new Error(
        "Incorrect API key provided: sk-proj-abcd***WXYZ. You can find your API key at https://platform.openai.com/account/api-keys.",
      ),
    );

    const result = await connect({ provider: "openai" });

    expect(result.success).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-proj-");
    expect(serialized).not.toContain("abcd");
    expect(serialized).not.toContain("WXYZ");
    // Redacted, not swallowed — the useful part of the message survives.
    expect(serialized).toContain("Incorrect API key provided");
  });

  it("leaves an ordinary provider error untouched", async () => {
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    fetchAvailableModelsMock.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await connect({ provider: "openai" });

    expect(result.error).toEqual({ kind: "text", text: "401 Unauthorized" });
  });
});

describe("connect-provider — it never seeds a model", () => {
  it("leaves selectedModel untouched on a successful connect", async () => {
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);

    const result = await connect({ provider: "openai" });

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
    expect(connectProviderToProfileMock).toHaveBeenCalledTimes(1);
    expect(connectProviderToProfileMock).toHaveBeenCalledWith("profile_1", "openai", [
      OPENAI_MODEL,
    ]);
  });

  it("leaves selectedModel untouched when it is currently '' (the inherit sentinel)", async () => {
    // "" is where a re-seeding handler looks harmless: nothing to overwrite.
    getProfileSettingMock.mockImplementation((key: string) =>
      key === "selectedModel" ? "" : [],
    );
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);

    const result = await connect({ provider: "openai" });

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
  });

  it("ignores a modelId a stale renderer still sends", async () => {
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);

    const result = await connect({ provider: "openai", modelId: "gpt-4o" });

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
    expect(connectProviderToProfileMock).toHaveBeenCalledWith("profile_1", "openai", [
      OPENAI_MODEL,
    ]);
  });
});

describe("connecting Ollama distinguishes 'down' from 'empty'", () => {
  it("fails when probeOllama reports the daemon unreachable", async () => {
    probeOllamaMock.mockResolvedValue({
      reachable: false,
      models: [],
      error: "connect ECONNREFUSED 127.0.0.1:11434",
    });

    const result = await connect({ provider: "ollama" });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "settings.general.providers.ollama.unreachable" },
    });
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });

  it("SUCCEEDS with a note when the daemon is reachable but has nothing pulled", async () => {
    probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });

    const result = await connect({ provider: "ollama" });

    // Failing here would leave Ollama unconnectable on a fresh install.
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.note).toEqual({
      kind: "message",
      message: { key: "settings.general.providers.ollama.noModels" },
    });
    expect(connectProviderToProfileMock).toHaveBeenCalledWith("profile_1", "ollama", []);
  });

  it("carries no note when the daemon is reachable with models", async () => {
    probeOllamaMock.mockResolvedValue({
      reachable: true,
      models: [{ id: "llama3.2:3b", name: "llama3.2", created: 1, provider: "ollama" }],
    });

    const result = await connect({ provider: "ollama" });

    expect(result.success).toBe(true);
    expect(result.note).toBeUndefined();
  });

  it("never falls back to fetchAvailableModels for ollama", async () => {
    // fetchAvailableModels answers `[]` for both, collapsing the two cases.
    await connect({ provider: "ollama" });

    expect(probeOllamaMock).toHaveBeenCalledTimes(1);
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
  });
});


describe("connect-provider — lmstudio", () => {
  it("fails when probeLmStudio reports the server unreachable", async () => {
    probeLmStudioMock.mockResolvedValue({
      reachable: false,
      models: [],
      error: "ECONNREFUSED",
    });
    const result = await connect({ provider: "lmstudio" });
    expect(result.success).toBe(false);
    expect(isLabel(result.error)).toBe(true);
    expect(connectProviderToProfileMock).not.toHaveBeenCalled();
  });

  it("connects with a note when reachable but empty", async () => {
    probeLmStudioMock.mockResolvedValue({ reachable: true, models: [] });
    const result = await connect({ provider: "lmstudio", host: "127.0.0.1", port: 1234 });
    expect(result.success).toBe(true);
    expect(isLabel(result.note)).toBe(true);
    expect(connectProviderToProfileMock).toHaveBeenCalledWith(
      "profile_1",
      "lmstudio",
      [],
      expect.objectContaining({
        endpoint: { host: "127.0.0.1", port: 1234 },
      }),
    );
  });

  it("stores an optional api key when provided", async () => {
    probeLmStudioMock.mockResolvedValue({
      reachable: true,
      models: [{ id: "local-model", name: "local-model", created: 1, provider: "lmstudio" }],
    });
    const result = await connect({
      provider: "lmstudio",
      host: "localhost",
      port: 1234,
      apiKey: "custom-key",
    });
    expect(result.success).toBe(true);
    expect(setProfileSecretMock).toHaveBeenCalledWith(
      "profile_1",
      "lmstudio",
      "api",
      "custom-key",
    );
  });
});
