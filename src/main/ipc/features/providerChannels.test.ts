/**
 * @file providerChannels.test.ts
 * @description The multi-provider read/write channels in `api.ts` that are
 * not `connect-provider` (that one has its own file): `get-provider-states`,
 * `disconnect-provider`, `fetch-ai-models`, `get-cached-models` and
 * `set-selected-model`.
 *
 * Handlers are captured from the real `registerApiHandlers` through a stub
 * `ipcMain.handle` and invoked directly. `~/shared/providers` and
 * `~/shared/modelRef` are deliberately left unmocked — they are the logic
 * under test, and a stand-in for any of them would test the stand-in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const {
  fetchAvailableModelsMock,
  fetchModelsForProvidersMock,
  probeOllamaMock,
  probeLmStudioMock,
  getApiKeyMock,
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
  getApiKeyMock: vi.fn(),
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
vi.mock("~/main/llm/models/compatibility", () => ({ checkModelCompatibility: vi.fn() }));
vi.mock("~/main/llm/models/discover", () => ({ probeOllama: probeOllamaMock }));
vi.mock("~/main/llm/providers/lmstudio/client", () => ({ probeLmStudio: probeLmStudioMock }));
vi.mock("~/main/llm/models/recommended", () => ({
  findRecommendedModel: vi.fn(),
  getRecommendedModels: vi.fn(),
}));
vi.mock("~/stores/apiKeyStore", () => ({
  clearApiKey: vi.fn(),
  getApiKey: getApiKeyMock,
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
// Slots derived from the real provider tables, never hand-listed.
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
import { registerApiHandlers, type ProviderStates } from "./api";
import type { Model, ProviderId } from "~/shared/providers";
import type { SecretKind } from "~/stores/profileSecretStore";

const OPENAI_MODEL: Model = { id: "gpt-4o", name: "gpt-4o", created: 3, provider: "openai" };
const OPENROUTER_MODEL: Model = {
  id: "anthropic/claude-3.5-sonnet",
  name: "Claude",
  created: 2,
  provider: "openrouter",
};
const OLLAMA_MODEL: Model = {
  id: "llama3.2:3b",
  name: "llama3.2",
  created: 1,
  provider: "ollama",
  local: { path: "llama3.2:3b" },
};

/** Distinguishable so a handler returning the RAW profile is visible. */
const STRIPPED_PROFILE = { id: "profile_1", strippedBy: "withoutProfileSecrets" };

/** Drives `getProfileSetting` for the two keys `api.ts` reads; anything else answers `[]`. */
const seedProfile = (settings: {
  models?: Model[];
  enabledProviders?: ProviderId[];
}): void => {
  getProfileSettingMock.mockImplementation((key: string) => {
    if (key === "models") return settings.models ?? [];
    if (key === "enabledProviders") return settings.enabledProviders ?? [];
    return [];
  });
};

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
  handlers.get(channel)?.(undefined, ...args);

beforeEach(() => {
  // Return values survive vi.clearAllMocks(); restore every default here.
  vi.clearAllMocks();
  handlers.clear();
  fetchAvailableModelsMock.mockResolvedValue([]);
  fetchModelsForProvidersMock.mockResolvedValue({ models: [], errors: {} });
  probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });
  probeLmStudioMock.mockResolvedValue({ reachable: true, models: [] });
  getApiKeyMock.mockResolvedValue(null);
  connectProviderToActiveProfileMock.mockReturnValue({ id: "profile_1" });
  connectProviderToProfileMock.mockReturnValue({ id: "profile_1" });
  disconnectProviderFromActiveProfileMock.mockReturnValue(null);
  disconnectProviderFromProfileMock.mockReturnValue(null);
  getCurrentProfileIdMock.mockReturnValue("profile_1");
  updateProfileSettingMock.mockReturnValue({ success: true });
  getProfileSecretMock.mockResolvedValue(null);
  hasProfileSecretMock.mockResolvedValue(false);
  setProfileSecretMock.mockResolvedValue({ success: true });
  clearProfileSecretMock.mockResolvedValue({ success: true });
  withoutProfileSecretsMock.mockImplementation(() => STRIPPED_PROFILE);
  seedProfile({});
  registerApiHandlers();
});

describe("get-provider-states answers every provider in one round-trip", () => {
  it("returns one entry per provider with the full state shape", async () => {
    seedProfile({
      models: [OPENAI_MODEL, OPENROUTER_MODEL, OLLAMA_MODEL],
      enabledProviders: ["openai", "ollama"],
    });
    hasProfileSecretMock.mockImplementation(
      async (_profileId: string, provider: ProviderId, kind: SecretKind) =>
        provider === "openai" && kind === "api",
    );

    const states = (await invoke("get-provider-states")) as ProviderStates;

    expect(Object.keys(states).sort()).toEqual(["lmstudio", "ollama", "openai", "openrouter"]);
    expect(states).toEqual({
      openai: {
        connected: true,
        configured: true,
        apiKeySet: true,
        provisioningKeySet: false,
        modelCount: 1,
      },
      openrouter: {
        connected: false,
        // A key provider with no key is not configured, whatever
        // enabledProviders says.
        configured: false,
        apiKeySet: false,
        provisioningKeySet: false,
        modelCount: 1,
      },
      ollama: {
        connected: true,
        // Ollama needs no key; being explicitly enabled IS being configured.
        configured: true,
        apiKeySet: false,
        provisioningKeySet: false,
        modelCount: 1,
      },
      lmstudio: {
        connected: false,
        configured: false,
        apiKeySet: false,
        provisioningKeySet: false,
        modelCount: 0,
      },
    });
  });

  it("reports `connected` and `configured` separately — a disconnected provider can still hold a key", async () => {
    // `set-selected-model` and `get-cached-models` gate on CONNECTED, so a UI
    // reading only `configured` would offer models the store then refuses.
    seedProfile({ models: [OPENAI_MODEL], enabledProviders: [] });
    hasProfileSecretMock.mockImplementation(
      async (_id: string, provider: ProviderId, kind: SecretKind) =>
        provider === "openai" && kind === "api",
    );

    const states = (await invoke("get-provider-states")) as ProviderStates;

    expect(states.openai.connected).toBe(false);
    expect(states.openai.configured).toBe(true);
    expect(states.openai.apiKeySet).toBe(true);
  });

  it("reports the provisioning key separately, and only for openrouter", async () => {
    hasProfileSecretMock.mockImplementation(
      async (_profileId: string, provider: ProviderId, kind: SecretKind) =>
        provider === "openrouter" && kind === "provisioning",
    );

    const states = (await invoke("get-provider-states")) as ProviderStates;

    expect(states.openrouter.provisioningKeySet).toBe(true);
    expect(states.openrouter.apiKeySet).toBe(false);
    expect(states.openai.provisioningKeySet).toBe(false);
    expect(states.ollama.provisioningKeySet).toBe(false);
  });

  it("answers all-false / zero when there is no active profile", async () => {
    getCurrentProfileIdMock.mockReturnValue("");
    hasProfileSecretMock.mockResolvedValue(true);

    const states = (await invoke("get-provider-states")) as ProviderStates;

    for (const state of Object.values(states)) {
      expect(state.connected).toBe(false);
      expect(state.apiKeySet).toBe(false);
      expect(state.provisioningKeySet).toBe(false);
    }
    expect(hasProfileSecretMock).not.toHaveBeenCalled();
  });

  it("leaks NO key material — asserted on the serialized JSON, for a profile that has keys stored", async () => {
    // SECURITY: there is deliberately no `get-api-key`, and this response must
    // never become a back door to one — not the key, not a prefix, not a
    // suffix, not a length, not a masked form.
    const SECRETS = {
      openaiKey: "sk-proj-REAL-OPENAI-SECRET-0123456789",
      openrouterKey: "sk-or-v1-REAL-OPENROUTER-SECRET-abcdef",
      provisioningKey: "sk-or-prov-REAL-PROVISIONING-SECRET-xyz",
    };
    getProfileSecretMock.mockImplementation(async (_id: string, provider: ProviderId, kind: SecretKind) =>
      provider === "openai"
        ? SECRETS.openaiKey
        : kind === "provisioning"
          ? SECRETS.provisioningKey
          : SECRETS.openrouterKey,
    );
    hasProfileSecretMock.mockResolvedValue(true);
    seedProfile({
      models: [OPENAI_MODEL, OPENROUTER_MODEL],
      enabledProviders: ["openai", "openrouter"],
    });

    const states = (await invoke("get-provider-states")) as ProviderStates;
    const json = JSON.stringify(states);

    // No secret, and no substring of one, survives serialization.
    for (const secret of Object.values(SECRETS)) {
      expect(json).not.toContain(secret);
      expect(json).not.toContain(secret.slice(0, 8));
      expect(json).not.toContain(secret.slice(-8));
    }
    // No string leaf at all: a masked form, prefix or placeholder would all be
    // strings, catching shapes the substring checks cannot enumerate.
    const leaves = Object.values(states).flatMap((state) => Object.values(state));
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(typeof leaf === "boolean" || typeof leaf === "number").toBe(true);
    }
    // The key length never leaks either — the only number is a model count.
    const numbers = leaves.filter((leaf) => typeof leaf === "number");
    expect(numbers).toEqual([1, 1, 0, 0]);
    for (const state of Object.values(states)) {
      expect(Object.keys(state).sort()).toEqual([
        "apiKeySet",
        "configured",
        "connected",
        "modelCount",
        "provisioningKeySet",
      ]);
    }
    // The handler never even asks for a decrypted key.
    expect(getProfileSecretMock).not.toHaveBeenCalled();
  });
});

describe("disconnect-provider", () => {
  const CLEARED = {
    selectedModel: true,
    presetIds: ["preset-1", "preset-2"],
    features: ["promptGen"] as const,
  };

  it("clears the API key and returns `cleared` byte-identical to the store's answer", async () => {
    disconnectProviderFromProfileMock.mockReturnValue({
      profile: { id: "profile_1" },
      cleared: CLEARED,
    });

    const result = (await invoke("disconnect-provider", "lmstudio")) as {
      success: boolean;
      cleared?: unknown;
    };

    expect(result.success).toBe(true);
    expect(clearProfileSecretMock).toHaveBeenCalledTimes(1);
    expect(clearProfileSecretMock).toHaveBeenCalledWith("profile_1", "lmstudio", "api");
    expect(disconnectProviderFromProfileMock).toHaveBeenCalledWith(
      "profile_1",
      "lmstudio",
    );
    // Identity, not deep equality: the warning renders exactly this object.
    expect(result.cleared).toBe(CLEARED);
  });

  it.each(["openrouter", "openai"] as const)(
    "clears the admin key too, for %s",
    async (provider) => {
      disconnectProviderFromProfileMock.mockReturnValue({
        profile: { id: "profile_1" },
        cleared: CLEARED,
      });

      await invoke("disconnect-provider", provider);

      expect(clearProfileSecretMock.mock.calls).toEqual([
        ["profile_1", provider, "api"],
        ["profile_1", provider, "provisioning"],
      ]);
    },
  );

  it("clears nothing for ollama, which has no credential slots", async () => {
    disconnectProviderFromProfileMock.mockReturnValue({
      profile: { id: "profile_1" },
      cleared: { selectedModel: false, presetIds: [], features: [] },
    });

    const result = (await invoke("disconnect-provider", "ollama")) as { success: boolean };

    expect(result.success).toBe(true);
    expect(clearProfileSecretMock).not.toHaveBeenCalled();
    expect(disconnectProviderFromProfileMock).toHaveBeenCalledWith("profile_1", "ollama");
  });

  it("rejects an unknown provider without deleting anything", async () => {
    const result = (await invoke("disconnect-provider", "anthropic")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.invalidSetup" },
    });
    expect(clearProfileSecretMock).not.toHaveBeenCalled();
    expect(disconnectProviderFromProfileMock).not.toHaveBeenCalled();
  });

  it("returns the SECRET-STRIPPED profile, never the raw one", async () => {
    const rawProfile = {
      id: "profile_1",
      settings: { apiKey: "sk-plaintext-legacy-not-yet-migrated" },
    };
    disconnectProviderFromProfileMock.mockReturnValue({
      profile: rawProfile,
      cleared: CLEARED,
    });

    const result = (await invoke("disconnect-provider", "openai")) as {
      profile?: unknown;
    };

    expect(withoutProfileSecretsMock).toHaveBeenCalledWith(rawProfile);
    expect(result.profile).toBe(STRIPPED_PROFILE);
    expect(JSON.stringify(result)).not.toContain("sk-plaintext-legacy");
  });

  it("reports a failed credential delete without disconnecting", async () => {
    clearProfileSecretMock.mockResolvedValue({ success: false, error: "EPERM" });

    const result = (await invoke("disconnect-provider", "openai")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({ kind: "text", text: "EPERM" });
    // Disconnecting with the key still on disk would make the confirmation
    // copy a lie.
    expect(disconnectProviderFromProfileMock).not.toHaveBeenCalled();
    expect(disconnectProviderFromActiveProfileMock).not.toHaveBeenCalled();
  });

  it("attempts EVERY slot even when an earlier one fails", async () => {
    // Kills a sequential loop bailing on the first failure, which would strand
    // OpenRouter's provisioning key on disk.
    clearProfileSecretMock.mockImplementation(
      async (_id: string, _provider: ProviderId, kind: SecretKind) =>
        kind === "api" ? { success: false, error: "EPERM" } : { success: true },
    );

    const result = (await invoke("disconnect-provider", "openrouter")) as {
      success: boolean;
    };

    expect(result.success).toBe(false);
    expect(clearProfileSecretMock.mock.calls).toEqual([
      ["profile_1", "openrouter", "api"],
      ["profile_1", "openrouter", "provisioning"],
    ]);
  });
});

describe("disconnect-provider is bound to the profile whose credentials it cleared", () => {
  const NOTHING_CLEARED = { selectedModel: false, presetIds: [], features: [] };

  // Two connected profiles behind both store entry points, each faked the way
  // apiStore.ts implements it: the bound variant writes to the id it is handed,
  // the active variant re-resolves the current profile at call time.
  const seedTwoConnectedProfiles = (): Map<string, ProviderId[]> => {
    const enabled = new Map<string, ProviderId[]>([
      ["profile_1", ["openai"]],
      ["profile_2", ["openai"]],
    ]);
    const disconnect = (profileId: string, provider: ProviderId) => {
      const providers = enabled.get(profileId);
      if (!providers) return null;
      enabled.set(
        profileId,
        providers.filter((entry) => entry !== provider),
      );
      return { profile: { id: profileId }, cleared: NOTHING_CLEARED };
    };
    disconnectProviderFromProfileMock.mockImplementation(disconnect);
    disconnectProviderFromActiveProfileMock.mockImplementation((provider: ProviderId) =>
      disconnect(getCurrentProfileIdMock() as string, provider),
    );
    return enabled;
  };

  // Ctrl+Shift+P landing while the credential delete is still in flight.
  const switchProfileDuringClear = (onSwitch?: () => void): void => {
    clearProfileSecretMock.mockImplementation(async () => {
      onSwitch?.();
      getCurrentProfileIdMock.mockReturnValue("profile_2");
      return { success: true };
    });
  };

  it("disconnects the originating profile, not the one switched to mid-flight", async () => {
    const enabled = seedTwoConnectedProfiles();
    switchProfileDuringClear();

    const result = (await invoke("disconnect-provider", "openai")) as { success: boolean };

    expect(result.success).toBe(true);
    expect(clearProfileSecretMock).toHaveBeenCalledWith("profile_1", "openai", "api");
    expect(enabled.get("profile_1")).toEqual([]);
    // profile_2 nobody disconnected keeps its refs — and its key on disk.
    expect(enabled.get("profile_2")).toEqual(["openai"]);
  });

  it("leaves nothing connected with its key already deleted when the store update fails", async () => {
    const enabled = seedTwoConnectedProfiles();
    switchProfileDuringClear(() => enabled.delete("profile_1"));

    const result = (await invoke("disconnect-provider", "openai")) as {
      success: boolean;
      error?: unknown;
    };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.activeProfileNotFound" },
    });
    // The deleted keys were profile_1's, and profile_1 is gone.
    expect(enabled.has("profile_1")).toBe(false);
    expect(enabled.get("profile_2")).toEqual(["openai"]);
  });
});

describe("fetch-ai-models fans out across every connected provider", () => {
  it("returns { models, errors } and passes the enabled set plus a key map", async () => {
    seedProfile({ enabledProviders: ["openai", "openrouter", "ollama"] });
    getApiKeyMock.mockResolvedValue("sk-or-key");
    getProfileSecretMock.mockResolvedValue("sk-openai-key");
    fetchModelsForProvidersMock.mockResolvedValue({
      models: [OPENAI_MODEL, OPENROUTER_MODEL],
      errors: { ollama: "connect ECONNREFUSED 127.0.0.1:11434" },
    });

    const result = (await invoke("fetch-ai-models", true)) as {
      success: boolean;
      models?: Model[];
      errors?: Record<string, string>;
    };

    expect(result.success).toBe(true);
    expect(result.models).toEqual([OPENAI_MODEL, OPENROUTER_MODEL]);
    expect(result.errors).toEqual({ ollama: "connect ECONNREFUSED 127.0.0.1:11434" });
    expect(fetchModelsForProvidersMock).toHaveBeenCalledWith(
      ["openai", "openrouter", "ollama"],
      // Ollama needs no key and is asked for none.
      { openai: "sk-openai-key", openrouter: "sk-or-key", ollama: "" },
      true,
    );
  });

  it("passes refetch=false for a plain mount", async () => {
    seedProfile({ enabledProviders: ["openai"] });

    await invoke("fetch-ai-models");

    expect(fetchModelsForProvidersMock).toHaveBeenCalledWith(["openai"], { openai: "" }, false);
  });

  it("filters a disconnected provider's stale slice out of the returned list", async () => {
    // `fetchModelsForProviders` merges every provider's cached slice on
    // purpose, so unfiltered the stale ones reappear here.
    seedProfile({ enabledProviders: ["openai"] });
    fetchModelsForProvidersMock.mockResolvedValue({
      models: [OPENAI_MODEL, OPENROUTER_MODEL, OLLAMA_MODEL],
      errors: {},
    });

    const result = (await invoke("fetch-ai-models", true)) as { models?: Model[] };

    expect(result.models).toEqual([OPENAI_MODEL]);
  });

  it("redacts a key a provider quoted back inside its error text", async () => {
    // SECURITY: these keys come from disk — the renderer has never seen them.
    seedProfile({ enabledProviders: ["openai"] });
    fetchModelsForProvidersMock.mockResolvedValue({
      models: [],
      errors: {
        openai:
          "Incorrect API key provided: sk-proj-abcd***WXYZ. You can find your API key at https://platform.openai.com/account/api-keys.",
      },
    });

    const result = (await invoke("fetch-ai-models", true)) as {
      errors?: Record<string, string>;
    };

    const serialized = JSON.stringify(result.errors);
    expect(serialized).not.toContain("sk-proj-");
    expect(serialized).not.toContain("abcd");
    expect(serialized).not.toContain("WXYZ");
    expect(serialized).toContain("Incorrect API key provided");
  });

  it("asks for nothing when no provider is connected", async () => {
    seedProfile({ enabledProviders: [] });

    const result = (await invoke("fetch-ai-models", true)) as { success: boolean };

    expect(result.success).toBe(true);
    expect(fetchModelsForProvidersMock).toHaveBeenCalledWith([], {}, true);
  });

  it("drops an unknown provider left in enabledProviders instead of asking for it", async () => {
    seedProfile({
      enabledProviders: ["openai", "anthropic" as ProviderId, "openai"],
    });

    await invoke("fetch-ai-models", true);

    expect(fetchModelsForProvidersMock).toHaveBeenCalledWith(["openai"], { openai: "" }, true);
  });
});

describe("get-cached-models is restricted to connected providers", () => {
  it("omits a disconnected provider's stale models", async () => {
    seedProfile({
      models: [OPENAI_MODEL, OPENROUTER_MODEL, OLLAMA_MODEL],
      enabledProviders: ["openai"],
    });

    expect(await invoke("get-cached-models")).toEqual([OPENAI_MODEL]);
  });

  it("returns models from every connected provider, each exactly once", async () => {
    seedProfile({
      models: [OPENAI_MODEL, OPENROUTER_MODEL, OLLAMA_MODEL],
      enabledProviders: ["openai", "openrouter", "ollama"],
    });

    expect(await invoke("get-cached-models")).toEqual([
      OPENAI_MODEL,
      OPENROUTER_MODEL,
      OLLAMA_MODEL,
    ]);
  });

  it("returns nothing when no provider is connected", async () => {
    seedProfile({ models: [OPENAI_MODEL, OPENROUTER_MODEL], enabledProviders: [] });

    expect(await invoke("get-cached-models")).toEqual([]);
  });
});

describe("set-selected-model — accepts only a resolvable ref on a connected provider", () => {
  beforeEach(() => {
    seedProfile({
      models: [OPENAI_MODEL, OPENROUTER_MODEL, OLLAMA_MODEL],
      enabledProviders: ["openai", "ollama"],
    });
  });

  it("accepts '' and stores it as the inherit sentinel", async () => {
    const result = (await invoke("set-selected-model", "")) as { success: boolean };

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).toHaveBeenCalledWith("selectedModel", "");
  });

  it("accepts a resolvable ref on a connected provider", async () => {
    const result = (await invoke("set-selected-model", "openai::gpt-4o")) as {
      success: boolean;
    };

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).toHaveBeenCalledWith("selectedModel", "openai::gpt-4o");
  });

  it("rejects a ref whose provider is NOT connected, even though the model is cached", async () => {
    // Accepting this would pick a model no key can serve.
    const result = (await invoke(
      "set-selected-model",
      "openrouter::anthropic/claude-3.5-sonnet",
    )) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.select.error.modelNotAvailableForProvider" },
    });
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
  });

  it("rejects an unresolvable ref", async () => {
    const result = (await invoke("set-selected-model", "openai::not-a-real-model")) as {
      success: boolean;
    };

    expect(result.success).toBe(false);
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string payload", async () => {
    for (const payload of [null, undefined, 42, { id: "gpt-4o" }]) {
      const result = (await invoke("set-selected-model", payload)) as { success: boolean };
      expect(result.success).toBe(false);
    }
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
  });

  it("no longer rejects a model just because another provider is 'active'", async () => {
    const result = (await invoke("set-selected-model", "ollama::llama3.2:3b")) as {
      success: boolean;
    };

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).toHaveBeenCalledWith(
      "selectedModel",
      "ollama::llama3.2:3b",
    );
  });
});

describe("set-selected-model stores the canonical ref, never the raw input", () => {
  it("upgrades a bare id to the composite ref before storing it", async () => {
    seedProfile({ models: [OPENAI_MODEL], enabledProviders: ["openai"] });

    const result = (await invoke("set-selected-model", "gpt-4o")) as { success: boolean };

    expect(result.success).toBe(true);
    // Storing the bare "gpt-4o" would route by PROVIDER_ORDER scan and bill
    // whichever provider lists that id first.
    expect(updateProfileSettingMock).toHaveBeenCalledWith("selectedModel", "openai::gpt-4o");
    expect(updateProfileSettingMock).not.toHaveBeenCalledWith("selectedModel", "gpt-4o");
  });

  it("an EXPLICIT ref names its provider even when another provider serves the same id", async () => {
    // The prefix decides; the cache order does not.
    const collidingOpenAI: Model = { ...OPENAI_MODEL, id: "gpt-4o", provider: "openai" };
    const collidingOpenRouter: Model = {
      id: "gpt-4o",
      name: "gpt-4o",
      created: 1,
      provider: "openrouter",
    };
    seedProfile({
      models: [collidingOpenAI, collidingOpenRouter],
      enabledProviders: ["openrouter"],
    });

    const result = (await invoke("set-selected-model", "openrouter::gpt-4o")) as {
      success: boolean;
    };

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).toHaveBeenCalledWith(
      "selectedModel",
      "openrouter::gpt-4o",
    );
  });

  it("a BARE colliding id is rejected rather than silently re-billed to another provider", async () => {
    // Deliberate: `resolveModelRef` scans PROVIDER_ORDER, so a bare id matches
    // the DISCONNECTED openai first and the gate rejects it. Failing closed
    // beats guessing a provider — a different key, a different price.
    const collidingOpenAI: Model = { ...OPENAI_MODEL, id: "gpt-4o", provider: "openai" };
    const collidingOpenRouter: Model = {
      id: "gpt-4o",
      name: "gpt-4o",
      created: 1,
      provider: "openrouter",
    };
    seedProfile({
      models: [collidingOpenAI, collidingOpenRouter],
      enabledProviders: ["openrouter"],
    });

    const result = (await invoke("set-selected-model", "gpt-4o")) as { success: boolean };

    expect(result.success).toBe(false);
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace before resolving", async () => {
    seedProfile({ models: [OPENAI_MODEL], enabledProviders: ["openai"] });

    const result = (await invoke("set-selected-model", "  openai::gpt-4o  ")) as {
      success: boolean;
    };

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).toHaveBeenCalledWith("selectedModel", "openai::gpt-4o");
  });
});
