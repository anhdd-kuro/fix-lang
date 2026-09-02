import { describe, expect, it } from "vitest";
import {
  PROVIDER_IDS,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
} from "~/features/providers/shared/providers";
import {
  PROVIDER_CAPABILITIES,
  providerCapabilities,
  usageCapableProviders,
} from "./index";

describe("provider capability registry", () => {
  it("holds a descriptor for every provider id", () => {
    for (const id of PROVIDER_IDS) {
      expect(providerCapabilities(id).id).toBe(id);
    }
    expect(Object.keys(PROVIDER_CAPABILITIES).sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it("derives supportsAdminKey from the shared provider table, never restating it", () => {
    for (const id of PROVIDER_IDS) {
      expect(providerCapabilities(id).supportsAdminKey).toBe(
        PROVIDER_SUPPORTS_PROVISIONING_KEY[id],
      );
    }
  });

  it("marks only the account-billed providers as usage-capable", () => {
    expect(providerCapabilities("openai").supportsUsage).toBe(true);
    expect(providerCapabilities("openrouter").supportsUsage).toBe(true);
    expect(providerCapabilities("ollama").supportsUsage).toBe(false);
    // LM Studio accepts an optional API key but bills nothing — the key tables
    // cannot stand in for this fact.
    expect(providerCapabilities("lmstudio").supportsUsage).toBe(false);
    // Anthropic bills an account, but its usage report needs an admin key no
    // profile stores — a Usage sub-tab here would have nothing to read.
    expect(providerCapabilities("anthropic").supportsUsage).toBe(false);
  });

  it("lists usage-capable providers in PROVIDER_ORDER", () => {
    expect(usageCapableProviders()).toEqual(["openai", "openrouter"]);
  });

  it("gives every provider a request slot, so makeAIRequest can never fall through", () => {
    for (const id of PROVIDER_IDS) {
      expect(providerCapabilities(id).makeRequest).toBeTypeOf("function");
    }
  });

  it("gives a model-list slot to the cloud providers only", () => {
    // Ollama and LM Studio are discovered by reachability probe, whose
    // "empty vs unreachable" distinction this signature cannot express.
    expect(providerCapabilities("openai").fetchModels).toBeTypeOf("function");
    expect(providerCapabilities("openrouter").fetchModels).toBeTypeOf("function");
    expect(providerCapabilities("anthropic").fetchModels).toBeTypeOf("function");
    expect(providerCapabilities("ollama").fetchModels).toBeUndefined();
    expect(providerCapabilities("lmstudio").fetchModels).toBeUndefined();
  });

  it("loads no provider implementation until a slot is called", async () => {
    // Importing this registry must stay cheap: `~/main/llm` re-exports it for the
    // Ollama client alone, and eager loading would drag the provider SDKs,
    // notifications and electron-store in with it (this very test file would
    // fail to load). Reading the slots is enough to prove they are not eager.
    expect(PROVIDER_CAPABILITIES.openai.makeRequest).toBeDefined();
    await expect(
      import("~/main/llm/providers/openai/models"),
    ).resolves.toHaveProperty("fetchOpenAIModels");
  });
});
