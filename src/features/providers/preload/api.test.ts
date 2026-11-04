/**
 * @file api.test.ts
 * @description The preload boundary for the provider channels: the connect
 * payload guard (`ProviderConnectInputSchema`), and the rule that **every** method
 * validates its input BEFORE `ipcRenderer.invoke` is reached. An invalid
 * payload that still crosses is a bypassed boundary even when main would have
 * rejected it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock, sendMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  sendMock: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcRenderer: { invoke: invokeMock, send: sendMock },
}));
import { PROVIDER_IDS } from "~/features/providers/shared/providers";
import {
  apiFeature,
  ProviderConnectInputSchema,
  type ProviderConnectInput,
} from "./api";

/**
 * The preload's shape check. Generic because a test input is arbitrary,
 * exactly as what the renderer hands over is.
 */
const isProviderConnectInput = <Input>(input: Input): boolean =>
  ProviderConnectInputSchema.safeParse(input).success;

beforeEach(() => {
  // Resolved values survive vi.clearAllMocks(), so reset them explicitly.
  vi.clearAllMocks();
  invokeMock.mockResolvedValue({ success: true });
});

describe("isProviderConnectInput", () => {
  it("accepts a bare provider — connect carries no modelId", () => {
    expect(isProviderConnectInput({ provider: "openai" })).toBe(true);
  });

  it("accepts a full input with apiKey and provisioningKey", () => {
    const input: ProviderConnectInput = {
      provider: "openrouter",
      apiKey: "sk-or-abc",
      provisioningKey: "sk-or-prov",
    };
    expect(isProviderConnectInput(input)).toBe(true);
  });

  it("accepts every provider id, derived from the registry rather than listed", () => {
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
    for (const provider of PROVIDER_IDS) {
      expect(isProviderConnectInput({ provider })).toBe(true);
    }
  });

  it("rejects a bad/unknown provider", () => {
    expect(isProviderConnectInput({ provider: "not-a-provider" })).toBe(false);
    expect(isProviderConnectInput({ provider: "" })).toBe(false);
    expect(isProviderConnectInput({})).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(isProviderConnectInput(null)).toBe(false);
    expect(isProviderConnectInput(undefined)).toBe(false);
    expect(isProviderConnectInput("openai")).toBe(false);
    expect(isProviderConnectInput(42)).toBe(false);
  });

  it("rejects a non-string apiKey", () => {
    expect(isProviderConnectInput({ provider: "openai", apiKey: 123 })).toBe(
      false,
    );
  });

  it("rejects a non-string provisioningKey", () => {
    expect(
      isProviderConnectInput({ provider: "openrouter", provisioningKey: {} }),
    ).toBe(false);
  });
});

describe("the bridge no longer exposes the deleted channel", () => {
  it("has no getActiveProvider", () => {
    expect("getActiveProvider" in apiFeature).toBe(false);
    expect(Object.keys(apiFeature)).not.toContain("getActiveProvider");
  });

  it("has no applyProviderSetup", () => {
    expect("applyProviderSetup" in apiFeature).toBe(false);
  });

  it("exposes connectProvider, disconnectProvider and getProviderStates", () => {
    expect(apiFeature.connectProvider).toBeTypeOf("function");
    expect(apiFeature.disconnectProvider).toBeTypeOf("function");
    expect(apiFeature.getProviderStates).toBeTypeOf("function");
  });
});

describe("every mutating method validates BEFORE it invokes", () => {
  it("connectProvider rejects an invalid input without crossing the boundary", async () => {
    const result = await apiFeature.connectProvider({
      provider: "not-a-provider" as ProviderConnectInput["provider"],
    });

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.invalidSetup" },
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("disconnectProvider rejects an invalid provider without crossing the boundary", async () => {
    const result = await apiFeature.disconnectProvider(
      "not-a-provider" as ProviderConnectInput["provider"],
    );

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      kind: "message",
      message: { key: "models.providerSetup.error.invalidSetup" },
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fetchProviderModels rejects an invalid input without crossing the boundary", async () => {
    const result = await apiFeature.fetchProviderModels({
      provider: "not-a-provider" as ProviderConnectInput["provider"],
    });

    expect(result.success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("setSelectedModel rejects a non-string without crossing the boundary", async () => {
    // @ts-expect-error -- a non-string is exactly what this guard must refuse
    const result = await apiFeature.setSelectedModel(42);

    expect(result.success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("valid calls reach the right channel and resync open windows", () => {
  it("connectProvider invokes connect-provider and broadcasts settings-updated", async () => {
    invokeMock.mockResolvedValue({ success: true, profile: { id: "p1" } });

    const result = await apiFeature.connectProvider({
      provider: "openai",
      apiKey: "sk-a",
    });

    expect(invokeMock).toHaveBeenCalledWith("connect-provider", {
      provider: "openai",
      apiKey: "sk-a",
    });
    expect(sendMock).toHaveBeenCalledWith("settings-updated");
    expect(result.success).toBe(true);
  });

  it("connectProvider does NOT broadcast when main reported failure", async () => {
    invokeMock.mockResolvedValue({
      success: false,
      error: { kind: "text", text: "401" },
    });

    const result = await apiFeature.connectProvider({
      provider: "openai",
      apiKey: "sk-a",
    });

    expect(result.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("connectProvider narrows a malformed note to undefined rather than passing it through", async () => {
    invokeMock.mockResolvedValue({ success: true, note: { kind: "nonsense" } });

    const result = await apiFeature.connectProvider({ provider: "ollama" });

    expect(result.note).toBeUndefined();
  });

  it("connectProvider surfaces a well-formed note", async () => {
    invokeMock.mockResolvedValue({
      success: true,
      note: {
        kind: "message",
        message: { key: "settings.general.providers.ollama.noModels" },
      },
    });

    const result = await apiFeature.connectProvider({ provider: "ollama" });

    expect(result.note).toEqual({
      kind: "message",
      message: { key: "settings.general.providers.ollama.noModels" },
    });
  });

  it("disconnectProvider passes `cleared` through unmodified", async () => {
    const cleared = {
      selectedModel: true,
      presetIds: ["p1"],
      features: ["promptGen"],
    };
    invokeMock.mockResolvedValue({ success: true, cleared });

    const result = await apiFeature.disconnectProvider("openrouter");

    expect(invokeMock).toHaveBeenCalledWith(
      "disconnect-provider",
      "openrouter",
    );
    expect(result.cleared).toEqual(cleared);
    expect(sendMock).toHaveBeenCalledWith("settings-updated");
  });

  it("getProviderStates is a plain read — no payload, no broadcast", async () => {
    invokeMock.mockResolvedValue({
      openai: {
        configured: true,
        apiKeySet: true,
        provisioningKeySet: false,
        modelCount: 2,
      },
    });

    await apiFeature.getProviderStates();

    expect(invokeMock).toHaveBeenCalledWith("get-provider-states");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("setSelectedModel broadcasts only when main accepted the ref", async () => {
    invokeMock.mockResolvedValue({ success: true });
    await apiFeature.setSelectedModel("openai::gpt-4o");
    expect(sendMock).toHaveBeenCalledWith("settings-updated");

    vi.clearAllMocks();
    invokeMock.mockResolvedValue({ success: false });
    await apiFeature.setSelectedModel("openrouter::not-connected");
    expect(invokeMock).toHaveBeenCalledWith(
      "set-selected-model",
      "openrouter::not-connected",
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("connectProvider does not forward an unexpected field main might add", async () => {
    // SECURITY: kills a `{ ...result }` spread, which would forward any
    // credential-bearing field a future handler edit adds.
    invokeMock.mockResolvedValue({
      success: true,
      profile: { id: "p1" },
      apiKey: "sk-should-never-cross",
    });

    const result = await apiFeature.connectProvider({
      provider: "openai",
      apiKey: "sk-a",
    });

    expect(JSON.stringify(result)).not.toContain("sk-should-never-cross");
    expect(Object.keys(result).sort()).toEqual([
      "error",
      "note",
      "profile",
      "success",
    ]);
  });

  it("disconnectProvider does not forward an unexpected field main might add", async () => {
    invokeMock.mockResolvedValue({
      success: true,
      cleared: { selectedModel: false, presetIds: [], features: [] },
      apiKey: "sk-should-never-cross",
    });

    const result = await apiFeature.disconnectProvider("openai");

    expect(JSON.stringify(result)).not.toContain("sk-should-never-cross");
    expect(Object.keys(result).sort()).toEqual([
      "cleared",
      "error",
      "profile",
      "success",
    ]);
  });

  it("fetchAIModels carries the per-provider errors map through", async () => {
    invokeMock.mockResolvedValue({
      success: true,
      models: [],
      errors: { ollama: "ECONNREFUSED" },
    });

    const result = await apiFeature.fetchAIModels(true);

    expect(invokeMock).toHaveBeenCalledWith("fetch-ai-models", true);
    expect(result.errors).toEqual({ ollama: "ECONNREFUSED" });
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

describe("isProviderConnectInput — pinned edge-case outputs", () => {
  it("matches the recorded verdict for every edge payload", () => {
    expect(
      connectPayloadEdgeCases.map(([label, input]) => [
        label,
        isProviderConnectInput(viaBoundary(input)),
      ]),
    ).toMatchSnapshot();
  });

  it("refuses a non-string model id or key without crossing the boundary", async () => {
    const nonStrings = [5, null, undefined, new String("m"), ["m"], {}];
    for (const value of nonStrings) {
      const selected = await apiFeature.setSelectedModel(viaBoundary(value));
      expect(selected.success).toBe(false);
      const stored = await apiFeature.setApiKey(viaBoundary(value));
      expect(stored.success).toBe(false);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
