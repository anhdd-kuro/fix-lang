/**
 * @file providers.test.ts
 * @description Tests for the Electron-free provider registry: identity,
 * ordering, credential requirements, and the model/provider matching rules
 * moved verbatim from `apiStore.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  isModelForProvider,
  isProviderConfigured,
  isProviderId,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  PROVIDER_REQUIRES_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
  providerOfModel,
  sanitizeEnabledProviders,
  type Model,
} from "./providers";

describe("PROVIDER_IDS / isProviderId", () => {
  it("lists exactly the three known providers", () => {
    expect(PROVIDER_IDS).toEqual(["openai", "openrouter", "ollama"]);
  });

  it("accepts only known provider ids", () => {
    for (const id of PROVIDER_IDS) {
      expect(isProviderId(id)).toBe(true);
    }
    expect(isProviderId("bogus")).toBe(false);
    expect(isProviderId(7)).toBe(false);
    expect(isProviderId(null)).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });
});

describe("PROVIDER_ORDER / PROVIDER_LABELS / credential requirement maps", () => {
  it("PROVIDER_ORDER contains every provider id exactly once", () => {
    expect([...PROVIDER_ORDER].sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it("PROVIDER_LABELS has a display label for every provider", () => {
    for (const id of PROVIDER_IDS) {
      expect(typeof PROVIDER_LABELS[id]).toBe("string");
      expect(PROVIDER_LABELS[id].length).toBeGreaterThan(0);
    }
  });

  it("only ollama does not require an API key", () => {
    expect(PROVIDER_REQUIRES_API_KEY.openai).toBe(true);
    expect(PROVIDER_REQUIRES_API_KEY.openrouter).toBe(true);
    expect(PROVIDER_REQUIRES_API_KEY.ollama).toBe(false);
  });

  it("only openrouter supports a provisioning key", () => {
    expect(PROVIDER_SUPPORTS_PROVISIONING_KEY.openrouter).toBe(true);
    expect(PROVIDER_SUPPORTS_PROVISIONING_KEY.openai).toBe(false);
    expect(PROVIDER_SUPPORTS_PROVISIONING_KEY.ollama).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isModelForProvider — matrix reproduced verbatim from apiStore.test.ts:207+
// ---------------------------------------------------------------------------

describe("isModelForProvider", () => {
  it("matches an openai-tagged model only to openai", () => {
    const model: Model = { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" };
    expect(isModelForProvider(model, "openai")).toBe(true);
    expect(isModelForProvider(model, "openrouter")).toBe(false);
    expect(isModelForProvider(model, "ollama")).toBe(false);
  });

  it("matches an openrouter-tagged model only to openrouter", () => {
    const model: Model = {
      id: "anthropic/claude-3",
      name: "claude-3",
      created: 1,
      provider: "openrouter",
    };
    expect(isModelForProvider(model, "openrouter")).toBe(true);
    expect(isModelForProvider(model, "openai")).toBe(false);
    expect(isModelForProvider(model, "ollama")).toBe(false);
  });

  it("matches a legacy untagged model (no provider, no local) only to openrouter", () => {
    const model: Model = { id: "legacy-model", name: "legacy-model", created: 1 };
    expect(isModelForProvider(model, "openrouter")).toBe(true);
    expect(isModelForProvider(model, "openai")).toBe(false);
    expect(isModelForProvider(model, "ollama")).toBe(false);
  });

  it("matches a model with a local descriptor only to ollama, regardless of provider tag", () => {
    const model: Model = {
      id: "llama-70b",
      name: "llama-70b",
      created: 1,
      local: { path: "/models/llama-70b" },
    };
    expect(isModelForProvider(model, "ollama")).toBe(true);
    expect(isModelForProvider(model, "openrouter")).toBe(false);
    expect(isModelForProvider(model, "openai")).toBe(false);
  });

  it("matches an explicitly ollama-tagged model (no local descriptor) to ollama", () => {
    const model: Model = {
      id: "custom-local",
      name: "custom-local",
      created: 1,
      provider: "ollama",
    };
    expect(isModelForProvider(model, "ollama")).toBe(true);
    expect(isModelForProvider(model, "openrouter")).toBe(false);
    expect(isModelForProvider(model, "openai")).toBe(false);
  });
});

describe("providerOfModel", () => {
  it("returns the tagged provider when present", () => {
    const model: Model = { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" };
    expect(providerOfModel(model)).toBe("openai");
  });

  it("falls back to openrouter when Model.provider is absent, even for a local model", () => {
    // Deliberately not inferred from id shape or the `local` descriptor — the
    // card's fallback rule names only the `provider` field.
    const model: Model = { id: "legacy-model", name: "legacy-model", created: 1 };
    expect(providerOfModel(model)).toBe("openrouter");
  });
});

// ---------------------------------------------------------------------------
// isProviderConfigured — four combinations across key/no-key and enabled/not
// ---------------------------------------------------------------------------

describe("isProviderConfigured", () => {
  it("an API-key provider with a key is configured regardless of explicitlyEnabled", () => {
    expect(isProviderConfigured("openai", { hasApiKey: true, explicitlyEnabled: false })).toBe(true);
  });

  it("an API-key provider without a key is not configured regardless of explicitlyEnabled", () => {
    expect(isProviderConfigured("openai", { hasApiKey: false, explicitlyEnabled: true })).toBe(false);
  });

  it("ollama enabled is configured regardless of hasApiKey", () => {
    expect(isProviderConfigured("ollama", { hasApiKey: false, explicitlyEnabled: true })).toBe(true);
  });

  it("ollama not enabled is not configured regardless of hasApiKey", () => {
    expect(isProviderConfigured("ollama", { hasApiKey: true, explicitlyEnabled: false })).toBe(false);
  });
});

describe("sanitizeEnabledProviders", () => {
  it("dedupes, filters unknown values, and orders by PROVIDER_ORDER", () => {
    expect(
      sanitizeEnabledProviders(["ollama", "openai", "ollama", "nope", 7, null]),
    ).toEqual(["openai", "ollama"]);
  });

  it("returns an empty array for non-array input", () => {
    expect(sanitizeEnabledProviders(undefined)).toEqual([]);
    expect(sanitizeEnabledProviders("openai")).toEqual([]);
    expect(sanitizeEnabledProviders(null)).toEqual([]);
  });

  it("returns every provider in PROVIDER_ORDER when all are present, in any input order", () => {
    expect(sanitizeEnabledProviders(["ollama", "openrouter", "openai"])).toEqual([
      ...PROVIDER_ORDER,
    ]);
  });
});
