/**
 * @file connectProvider.test.ts
 * @description The `connect-provider` handler (formerly `apply-provider-setup`).
 *
 * Two jobs. It carries forward the original M1 regression — Apply must FAIL
 * when the live model fetch used for validation throws (a stale/revoked key),
 * even though models for that provider are still cached — and it pins the new
 * connect contract: no `modelId` in the payload, no write to `selectedModel`,
 * an Ollama probe that distinguishes "daemon down" from "nothing pulled", and
 * the removal of `get-active-provider`.
 *
 * This captures the real handlers registered by `registerApiHandlers` (via a
 * stub `ipcMain.handle`) and invokes them directly, so the test exercises the
 * actual handler wiring.
 *
 * **`~/shared/providers` and `~/shared/modelRef` are deliberately NOT mocked.**
 * The file this replaces hand-rolled `isProviderId` and `isModelForProvider`
 * in the `~/stores/apiStore` mock; a hand-written stand-in for the predicate
 * under refactor tests the stand-in, not the code, and it stayed green through
 * the whole refactor precisely because it did. `api.ts` now imports those
 * predicates straight from the shared registry, so the real implementations
 * run here with no mock at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLabel } from "~/shared/i18n/message";
const {
  fetchAvailableModelsMock,
  fetchModelsForProvidersMock,
  probeOllamaMock,
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
vi.mock("~/main/llm/models/compatibility", () => ({
  checkModelCompatibility: vi.fn(),
}));
vi.mock("~/main/llm/models/discover", () => ({ probeOllama: probeOllamaMock }));
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
// `profileSecretStore` reaches `app.getPath` at import, so it cannot be
// `importActual`'d here. `secretKindsForProvider` is DERIVED from the real,
// unmocked provider tables rather than hand-listed per provider, so a fourth
// provider inherits the right slots in this mock exactly as it does in
// production.
vi.mock("~/stores/profileSecretStore", async () => {
  const { PROVIDER_REQUIRES_API_KEY, PROVIDER_SUPPORTS_PROVISIONING_KEY } =
    await import("~/shared/providers");
  return {
    clearProfileSecret: clearProfileSecretMock,
    getProfileSecret: getProfileSecretMock,
    hasProfileSecret: hasProfileSecretMock,
    setProfileSecret: setProfileSecretMock,
    secretKindsForProvider: (provider: "openai" | "openrouter" | "ollama") => [
      ...(PROVIDER_REQUIRES_API_KEY[provider] ? ["api"] : []),
      ...(PROVIDER_SUPPORTS_PROVISIONING_KEY[provider] ? ["provisioning"] : []),
    ],
  };
});
// Import (after mocks) — registers the real handlers into the `handlers` map.
import { registerApiHandlers } from "./api";
import type { Model } from "~/shared/providers";

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
  // vi.clearAllMocks() clears CALLS but not return values, so every default
  // is restored explicitly — a value set by one test otherwise leaks into
  // every later test in this file.
  vi.clearAllMocks();
  handlers.clear();
  fetchAvailableModelsMock.mockResolvedValue([OPENAI_MODEL]);
  fetchModelsForProvidersMock.mockResolvedValue({ models: [], errors: {} });
  probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });
  connectProviderToActiveProfileMock.mockReturnValue({ id: "profile_1" });
  disconnectProviderFromActiveProfileMock.mockReturnValue(null);
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

describe("D23 — the registered channel set", () => {
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
    expect(connectProviderToActiveProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a non-object payload", async () => {
    for (const payload of [null, undefined, "openai", 42]) {
      const result = await connect(payload);
      expect(result.success).toBe(false);
    }
    expect(connectProviderToActiveProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a provisioning key on a provider that has no provisioning slot", async () => {
    const result = await connect({
      provider: "openai",
      apiKey: "sk-abc",
      provisioningKey: "sk-or-prov",
    });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.provisioningKeyOpenRouterOnly" },
    });
    expect(connectProviderToActiveProfileMock).not.toHaveBeenCalled();
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
    expect(connectProviderToActiveProfileMock).not.toHaveBeenCalled();
  });

  it("does NOT require a key for ollama", async () => {
    probeOllamaMock.mockResolvedValue({
      reachable: true,
      models: [{ id: "llama3.2:3b", name: "llama3.2", created: 1, provider: "ollama" }],
    });

    const result = await connect({ provider: "ollama" });

    expect(result.success).toBe(true);
    // No credential path is touched at all for a keyless provider.
    expect(getProfileSecretMock).not.toHaveBeenCalled();
    expect(setProfileSecretMock).not.toHaveBeenCalled();
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
    expect(connectProviderToActiveProfileMock).toHaveBeenCalledWith("ollama", [
      { id: "llama3.2:3b", name: "llama3.2", created: 1, provider: "ollama" },
    ]);
  });
});

describe("connect-provider — M1: a stale key must fail, not pass via the cache", () => {
  it("fails when the live fetch throws, even though the provider has cached models", async () => {
    // Cached models exist for openai from a previously successful connect —
    // this is exactly what let a stale key silently "pass" before the fix.
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
    // A provider-reported failure is opaque text, never app copy.
    expect(isLabel(result.error)).toBe(true);
    expect(result.error).toEqual({ kind: "text", text: "401 Unauthorized" });
    expect(fetchAvailableModelsMock).toHaveBeenCalledWith(
      "sk-stale-revoked-key",
      "openai",
      false,
      true,
    );
    // Nothing is committed and no credential is written when validation fails.
    expect(connectProviderToActiveProfileMock).not.toHaveBeenCalled();
    expect(setProfileSecretMock).not.toHaveBeenCalled();
  });

  it("succeeds when the live fetch resolves (control case)", async () => {
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);

    const result = await connect({ provider: "openai" });

    expect(result.success).toBe(true);
    expect(connectProviderToActiveProfileMock).toHaveBeenCalledWith("openai", [OPENAI_MODEL]);
  });

  it("stores a newly supplied key only AFTER the live fetch validated it", async () => {
    const result = await connect({ provider: "openai", apiKey: "sk-new" });

    expect(result.success).toBe(true);
    expect(setProfileSecretMock).toHaveBeenCalledWith("profile_1", "openai", "api", "sk-new");
    expect(fetchAvailableModelsMock).toHaveBeenCalledWith("sk-new", "openai", false, true);
    // ORDER, not just "both happened". Asserting only that each was called
    // passes just as happily when the write is moved above the fetch, which
    // is the whole failure this test exists for.
    expect(setProfileSecretMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      fetchAvailableModelsMock.mock.invocationCallOrder[0],
    );
  });

  it("never persists a SUPPLIED key that the live fetch rejected", async () => {
    // The M1 test above covers a key already on disk, so its `payload.apiKey`
    // branch is skipped — a write moved above the fetch would be invisible to
    // it. This drives the typed-key path: a user pastes a typo, the provider
    // 401s, and the typo must not land on disk over a working key.
    fetchAvailableModelsMock.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await connect({ provider: "openai", apiKey: "sk-typo" });

    expect(result.success).toBe(false);
    expect(setProfileSecretMock).not.toHaveBeenCalled();
    expect(connectProviderToActiveProfileMock).not.toHaveBeenCalled();
  });
});

describe("connect-provider — what crosses back to the renderer", () => {
  it("returns the SECRET-STRIPPED profile, never the raw one", async () => {
    // `SettingsStore` still declares the deprecated plaintext `apiKey`, and
    // the legacy migration scrubs only the active profile and only on a
    // successful secret write. Returning the raw profile would hand the
    // renderer a decrypted key.
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);
    connectProviderToActiveProfileMock.mockReturnValue(RAW_PROFILE);

    const result = await connect({ provider: "openai" });

    expect(withoutProfileSecretsMock).toHaveBeenCalledWith(RAW_PROFILE);
    expect(result.profile).toBe(STRIPPED_PROFILE);
    expect(JSON.stringify(result)).not.toContain("sk-plaintext-legacy");
  });

  it("redacts a provider error that quotes the key back", async () => {
    // OpenAI's own 401 body echoes a masked key: prefix AND suffix of a
    // credential the renderer never typed (this path authenticates with the
    // STORED key). Neither half may cross.
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
    // The useful part of the message survives, which is why it is redacted
    // rather than swallowed.
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
    // The whole point of splitting connect from model choice: no write to
    // selectedModel, and no write to any other profile setting either.
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
    expect(connectProviderToActiveProfileMock).toHaveBeenCalledTimes(1);
    expect(connectProviderToActiveProfileMock).toHaveBeenCalledWith("openai", [OPENAI_MODEL]);
  });

  it("leaves selectedModel untouched when it is currently '' (the inherit sentinel)", async () => {
    // "" is the case a re-seeding handler would look harmless on: there is
    // nothing to overwrite, so a regression here would only bite the users
    // who had already chosen a model. Pinned separately for that reason.
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
    // `modelId` is gone from the payload type. A caller that still sends one
    // must not be able to reach the profile default through this channel.
    getProfileSecretMock.mockResolvedValue("sk-good-key");
    hasProfileSecretMock.mockResolvedValue(true);

    const result = await connect({ provider: "openai", modelId: "gpt-4o" });

    expect(result.success).toBe(true);
    expect(updateProfileSettingMock).not.toHaveBeenCalled();
    expect(connectProviderToActiveProfileMock).toHaveBeenCalledWith("openai", [OPENAI_MODEL]);
  });
});

describe("D26 — connecting Ollama distinguishes 'down' from 'empty'", () => {
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
    expect(connectProviderToActiveProfileMock).not.toHaveBeenCalled();
  });

  it("SUCCEEDS with a note when the daemon is reachable but has nothing pulled", async () => {
    probeOllamaMock.mockResolvedValue({ reachable: true, models: [] });

    const result = await connect({ provider: "ollama" });

    // Reachable-but-empty is a real connection: the provider is connected and
    // the note tells the user to pull something. Reporting it as a failure
    // would leave Ollama permanently unconnectable on a fresh install.
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.note).toEqual({
      kind: "message",
      message: { key: "settings.general.providers.ollama.noModels" },
    });
    expect(connectProviderToActiveProfileMock).toHaveBeenCalledWith("ollama", []);
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
    // fetchAvailableModels swallows the connection error and answers `[]`, so
    // routing Ollama through it collapses "down" and "empty" into one answer.
    await connect({ provider: "ollama" });

    expect(probeOllamaMock).toHaveBeenCalledTimes(1);
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
  });
});
