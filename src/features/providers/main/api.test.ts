/**
 * @file api.test.ts
 * @description Validation unit tests for the provider-connect payload parser
 * (`ProviderConnectPayloadSchema`). Pure input-shape rejection tests — no Electron IPC
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
  createOllamaClient: () => ({ pull: vi.fn(), delete: vi.fn(), chat: vi.fn() }),
  ollamaClient: { pull: vi.fn(), delete: vi.fn(), chat: vi.fn() },
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
  withoutProfileSecrets: vi.fn((profile: Profile) => profile),
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
// Import (after mocks) — the real schema under test.
import { ProviderConnectPayloadSchema } from "./api";
import type { Profile } from "~/features/providers/store/apiStore";

/**
 * The handlers' parse step: the schema's result, or `null` when the payload is
 * refused. Generic because a test payload is arbitrary, exactly as IPC is.
 */
const parseProviderConnect = <Payload>(payload: Payload) => {
  const parsed = ProviderConnectPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

describe("parseProviderConnect", () => {
  it("accepts a bare provider — no modelId is required or carried", () => {
    expect(parseProviderConnect({ provider: "openai" })).toEqual({
      provider: "openai",
    });
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
    const parsed = parseProviderConnect({
      provider: "ollama",
      modelId: "llama3",
    });

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
    expect(parseProviderConnect({ provider: "not-a-provider" })).toBeNull();
    expect(parseProviderConnect({ provider: "" })).toBeNull();
    expect(parseProviderConnect({})).toBeNull();
  });

  it("rejects a provider carried on the prototype rather than the object", () => {
    expect(parseProviderConnect({ provider: "constructor" })).toBeNull();
    expect(parseProviderConnect({ provider: "toString" })).toBeNull();
  });

  it("rejects a non-string apiKey", () => {
    expect(
      parseProviderConnect({ provider: "openai", apiKey: 123 }),
    ).toBeNull();
    expect(
      parseProviderConnect({ provider: "openai", apiKey: null }),
    ).toBeNull();
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

/**
 * Edge payloads reach the connect parser from IPC with no static type at all;
 * this models that, so a narrowed parameter type cannot hide a runtime case.
 */
const viaBoundary = <Value>(value: Value): never => value as never;

const connectPayloadEdgeCases: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["0", 0],
  ["string", "openai"],
  ["function", () => ({ provider: "openai" })],
  ["boxed string", new String("openai")],
  ["empty array", []],
  [
    "array carrying fields",
    Object.assign([], { provider: "openai", apiKey: "k" }),
  ],
  ["inherited fields", Object.create({ provider: "openai", apiKey: "k" })],
  [
    "null prototype",
    Object.assign(Object.create(null), { provider: "anthropic", apiKey: "k" }),
  ],
  [
    "class instance",
    new (class {
      provider = "openrouter";
      provisioningKey = "p";
    })(),
  ],
  ["bare provider", { provider: "openai" }],
  ["constructor provider", { provider: "constructor" }],
  ["boxed provider", { provider: new String("openai") }],
  [
    "every string field",
    {
      provider: "bedrock",
      apiKey: "AKIA",
      secretKey: "s",
      provisioningKey: "p",
      region: "us-east-1",
      projectId: "",
      host: "127.0.0.1",
      port: 1234,
      modelId: "dropped",
    },
  ],
  [
    "explicit undefined fields",
    { provider: "openai", apiKey: undefined, port: undefined, host: undefined },
  ],
  ["null apiKey", { provider: "openai", apiKey: null }],
  ["numeric secretKey", { provider: "bedrock", secretKey: 5 }],
  ["numeric region", { provider: "bedrock", region: 5 }],
  ["numeric projectId", { provider: "openai", projectId: 5 }],
  ["boxed apiKey", { provider: "openai", apiKey: new String("k") }],
  ["padded host", { provider: "lmstudio", host: "  localhost  " }],
  ["blank host", { provider: "lmstudio", host: "   " }],
  ["scheme host", { provider: "lmstudio", host: "http://x" }],
  ["numeric host", { provider: "lmstudio", host: 5 }],
  ["null host", { provider: "lmstudio", host: null }],
  ["string port", { provider: "ollama", port: "11435" }],
  ["padded string port", { provider: "ollama", port: " 11435 " }],
  ["blank string port", { provider: "ollama", port: " " }],
  ["fractional port", { provider: "ollama", port: 12.5 }],
  ["NaN port", { provider: "ollama", port: Number.NaN }],
  ["zero port", { provider: "ollama", port: 0 }],
  ["out-of-range port", { provider: "ollama", port: 70000 }],
  ["boolean port", { provider: "ollama", port: true }],
  ["null port", { provider: "ollama", port: null }],
  ["hex string port", { provider: "ollama", port: "0x10" }],
];

describe("parseProviderConnect — pinned edge-case outputs", () => {
  it("matches the recorded output for every edge payload", () => {
    expect(
      connectPayloadEdgeCases.map(([label, payload]) => {
        const parsed = parseProviderConnect(viaBoundary(payload));
        return [
          label,
          parsed === null ? null : { keys: Object.keys(parsed), parsed },
        ];
      }),
    ).toMatchSnapshot();
  });
});
