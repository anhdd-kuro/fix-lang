/**
 * @file providerChannels.test.ts
 * @description The multi-provider read/write channels in `api.ts` that are
 * not `connect-provider` (that one has its own file): `get-provider-states`,
 * `disconnect-provider`, `fetch-ai-models`, `get-cached-models` and
 * `set-selected-model`.
 *
 * Handlers are captured from the real `registerApiHandlers` through a stub
 * `ipcMain.handle` and invoked directly. `~/shared/providers` and
 * `~/shared/modelRef` are deliberately left unmocked — `sanitizeEnabledProviders`,
 * `isModelForProvider`, `isProviderConfigured` and `resolveModelRef` are the
 * logic under test, and a stand-in for any of them would test the stand-in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const {
  fetchAvailableModelsMock,
  fetchModelsForProvidersMock,
  probeOllamaMock,
  getApiKeyMock,
  connectProviderToActiveProfileMock,
  disconnectProviderFromActiveProfileMock,
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
  getApiKeyMock: vi.fn(),
  connectProviderToActiveProfileMock: vi.fn(),
  disconnectProviderFromActiveProfileMock: vi.fn(),
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
  disconnectProviderFromActiveProfile: disconnectProviderFromActiveProfileMock,
  getCurrentProfileId: getCurrentProfileIdMock,
  getDefaultModelId: vi.fn(),
  getProfileSetting: getProfileSettingMock,
  resetCurrentProfileSettings: vi.fn(),
  updateProfileSetting: updateProfileSettingMock,
  withoutProfileSecrets: withoutProfileSecretsMock,
}));
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: { resetKeyBindings: vi.fn() },
}));
// Derived from the real provider tables, never hand-listed — see the same
// note in connectProvider.test.ts.
vi.mock("~/stores/profileSecretStore", async () => {
  const { PROVIDER_REQUIRES_API_KEY, PROVIDER_SUPPORTS_PROVISIONING_KEY } =
    await import("~/shared/providers");
  return {
    clearProfileSecret: clearProfileSecretMock,
    getProfileSecret: getProfileSecretMock,
    hasProfileSecret: hasProfileSecretMock,
    setProfileSecret: setProfileSecretMock,
    secretKindsForProvider: (provider: ProviderId) => [
      ...(PROVIDER_REQUIRES_API_KEY[provider] ? ["api"] : []),
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

/**
 * Drives `getProfileSetting` for the two keys `api.ts` reads. Anything else
 * answers `[]`, matching the store's own empty-ish default.
 */
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
  getApiKeyMock.mockResolvedValue(null);
  connectProviderToActiveProfileMock.mockReturnValue({ id: "profile_1" });
  disconnectProviderFromActiveProfileMock.mockReturnValue(null);
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

// ---------------------------------------------------------------------------
// D25 — get-provider-states
// ---------------------------------------------------------------------------

describe("D25 — get-provider-states answers every provider in one round-trip", () => {
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

    expect(Object.keys(states).sort()).toEqual(["ollama", "openai", "openrouter"]);
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
    });
  });

  it("reports `connected` and `configured` separately — a disconnected provider can still hold a key", async () => {
    // The state card 07 needs and `configured` alone cannot express: the user
    // disconnected OpenAI but the key is still on disk. `set-selected-model`
    // and `get-cached-models` both gate on CONNECTED, so a UI reading only
    // `configured` would offer models the store then refuses.
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
    // The security constraint this whole channel is shaped around: there is
    // deliberately no `get-api-key`, and this response must never become a
    // back door to one — not the key, not a prefix, not a suffix, not a
    // length, not a masked form.
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

    // 1. No secret, and no substring of one, survives serialization.
    for (const secret of Object.values(SECRETS)) {
      expect(json).not.toContain(secret);
      expect(json).not.toContain(secret.slice(0, 8));
      expect(json).not.toContain(secret.slice(-8));
    }
    // 2. Nothing that even looks like a key: no string leaf at all. A masked
    //    form ("sk-…cdef"), a prefix or a placeholder would all be strings,
    //    so this catches shapes the substring checks above cannot enumerate.
    const leaves = Object.values(states).flatMap((state) => Object.values(state));
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(typeof leaf === "boolean" || typeof leaf === "number").toBe(true);
    }
    // 3. The key length never leaks either — the only number is a model count.
    const numbers = leaves.filter((leaf) => typeof leaf === "number");
    expect(numbers).toEqual([1, 1, 0]);
    // The shape is exactly the five documented fields — nothing extra.
    for (const state of Object.values(states)) {
      expect(Object.keys(state).sort()).toEqual([
        "apiKeySet",
        "configured",
        "connected",
        "modelCount",
        "provisioningKeySet",
      ]);
    }
    // 4. The handler never even asks for a decrypted key.
    expect(getProfileSecretMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// disconnect-provider
// ---------------------------------------------------------------------------

describe("disconnect-provider", () => {
  const CLEARED = {
    selectedModel: true,
    presetIds: ["preset-1", "preset-2"],
    features: ["promptGen"] as const,
  };

  it("clears the API key and returns `cleared` byte-identical to the store's answer", async () => {
    disconnectProviderFromActiveProfileMock.mockReturnValue({
      profile: { id: "profile_1" },
      cleared: CLEARED,
    });

    const result = (await invoke("disconnect-provider", "openai")) as {
      success: boolean;
      cleared?: unknown;
    };

    expect(result.success).toBe(true);
    expect(clearProfileSecretMock).toHaveBeenCalledTimes(1);
    expect(clearProfileSecretMock).toHaveBeenCalledWith("profile_1", "openai", "api");
    expect(disconnectProviderFromActiveProfileMock).toHaveBeenCalledWith("openai");
    // Passed through unmodified — card 07's warning renders exactly this.
    expect(result.cleared).toBe(CLEARED);
  });

  it("clears the provisioning key too, for openrouter only", async () => {
    disconnectProviderFromActiveProfileMock.mockReturnValue({
      profile: { id: "profile_1" },
      cleared: CLEARED,
    });

    await invoke("disconnect-provider", "openrouter");

    expect(clearProfileSecretMock.mock.calls).toEqual([
      ["profile_1", "openrouter", "api"],
      ["profile_1", "openrouter", "provisioning"],
    ]);
  });

  it("clears nothing for ollama, which has no credential slots", async () => {
    disconnectProviderFromActiveProfileMock.mockReturnValue({
      profile: { id: "profile_1" },
      cleared: { selectedModel: false, presetIds: [], features: [] },
    });

    const result = (await invoke("disconnect-provider", "ollama")) as { success: boolean };

    expect(result.success).toBe(true);
    expect(clearProfileSecretMock).not.toHaveBeenCalled();
    expect(disconnectProviderFromActiveProfileMock).toHaveBeenCalledWith("ollama");
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
    expect(disconnectProviderFromActiveProfileMock).not.toHaveBeenCalled();
  });

  it("returns the SECRET-STRIPPED profile, never the raw one", async () => {
    const rawProfile = {
      id: "profile_1",
      settings: { apiKey: "sk-plaintext-legacy-not-yet-migrated" },
    };
    disconnectProviderFromActiveProfileMock.mockReturnValue({
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
    // The confirmation copy promises the stored key will be deleted;
    // disconnecting after failing to delete it would make that a lie.
    expect(disconnectProviderFromActiveProfileMock).not.toHaveBeenCalled();
  });

  it("attempts EVERY slot even when an earlier one fails", async () => {
    // A sequential loop that returned on the first failure would strand
    // OpenRouter's provisioning key on disk whenever the API key delete
    // failed — a credential left behind for a provider the user is trying to
    // disconnect, which no test of the *other* slot would notice.
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

// ---------------------------------------------------------------------------
// fetch-ai-models — fan-out
// ---------------------------------------------------------------------------

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
    // `fetchModelsForProviders` deliberately merges the previously cached
    // slice for EVERY provider in PROVIDER_ORDER, not just the requested
    // ones, so an unasked provider's cache survives the write. Unfiltered,
    // that reappears here and contradicts `get-cached-models`.
    seedProfile({ enabledProviders: ["openai"] });
    fetchModelsForProvidersMock.mockResolvedValue({
      models: [OPENAI_MODEL, OPENROUTER_MODEL, OLLAMA_MODEL],
      errors: {},
    });

    const result = (await invoke("fetch-ai-models", true)) as { models?: Model[] };

    expect(result.models).toEqual([OPENAI_MODEL]);
  });

  it("redacts a key a provider quoted back inside its error text", async () => {
    // These keys come from disk — the renderer has never seen them.
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

// ---------------------------------------------------------------------------
// get-cached-models
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// D24 + F7 — set-selected-model
// ---------------------------------------------------------------------------

describe("D24 — set-selected-model", () => {
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
    // openrouter's slice is still in the cache but the provider is not in
    // enabledProviders — accepting this would pick a model no key can serve.
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
    // The rule this replaces compared the model against a single active
    // provider, so with openai "active" an Ollama model was refused outright.
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

describe("F7 — set-selected-model stores the canonical ref, never the raw input", () => {
  it("upgrades a bare id to the composite ref before storing it", async () => {
    seedProfile({ models: [OPENAI_MODEL], enabledProviders: ["openai"] });

    const result = (await invoke("set-selected-model", "gpt-4o")) as { success: boolean };

    expect(result.success).toBe(true);
    // Storing the bare "gpt-4o" would de-migrate the field: the value stops
    // naming a provider and routing falls back to the PROVIDER_ORDER scan,
    // which bills whichever provider happens to list that id first.
    expect(updateProfileSettingMock).toHaveBeenCalledWith("selectedModel", "openai::gpt-4o");
    expect(updateProfileSettingMock).not.toHaveBeenCalledWith("selectedModel", "gpt-4o");
  });

  it("an EXPLICIT ref names its provider even when another provider serves the same id", async () => {
    // The same id served by two providers is the ambiguity composite refs
    // exist to kill. The prefix decides; the cache order does not.
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
    // Documented, deliberate, and the safe direction. `resolveModelRef` scans
    // PROVIDER_ORDER, so a bare "gpt-4o" matches the DISCONNECTED openai
    // first; the enabledProviders gate then rejects it, even though the
    // connected openrouter serves the same id. Failing closed is right: the
    // alternative is guessing a provider — a different key, a different
    // price — from an id shape, which is exactly what this refactor removes.
    // A renderer never sends a bare id (the picker emits refs); this is the
    // hand-edited-config / stale-caller path.
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
