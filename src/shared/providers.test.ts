/**
 * @file providers.test.ts
 * @description Tests for the Electron-free provider registry: identity,
 * ordering, credential requirements, and the model/provider matching rules
 * moved verbatim from `apiStore.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  groupModelsByProvider,
  isModelForProvider,
  modelsForProvider,
  isProviderConfigured,
  isProviderId,
  PROVIDER_IDS,
  PROVIDER_LOG_LABELS,
  PROVIDER_ORDER,
  PROVIDER_REQUIRES_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
  providerOfModel,
  sanitizeEnabledProviders,
  type Model,
  type ProviderId,
} from "./providers";

// ---------------------------------------------------------------------------
// F9 — the "no Electron, no ~/stores/*, no Node built-in" rule for this module
// pair was previously enforced only by a manual grep and, indirectly, by
// `bun run build`. Assert it on the source text so `bun run test` catches it.
// A source-text assertion on purpose: a dynamic-import probe would only prove
// the module loads, not that the forbidden dependency is absent.
// ---------------------------------------------------------------------------

describe("Electron-free module boundary", () => {
  const SOURCE_FILES = ["providers.ts", "modelRef.ts"] as const;
  const FORBIDDEN_SPECIFIER = /^(electron($|\/|-)|~\/stores\/|@\/stores\/|node:)/;
  // `from "x"`, `require("x")`, `import("x")` — quoted specifiers only, so
  // prose that merely mentions Electron in a doc comment does not trip it.
  const SPECIFIER = /(?:\bfrom|\brequire\s*\(|\bimport\s*\()\s*["']([^"']+)["']/g;

  for (const file of SOURCE_FILES) {
    it(`${file} imports nothing from electron, the stores directory, or a Node built-in`, () => {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      const specifiers = [...source.matchAll(SPECIFIER)].map(([, specifier]) => specifier);

      expect(specifiers.filter((specifier) => FORBIDDEN_SPECIFIER.test(specifier))).toEqual([]);
    });
  }

  it("the matcher actually rejects the imports it is guarding against", () => {
    for (const specifier of [
      "electron",
      "electron-store",
      "electron/main",
      "~/stores/apiStore",
      "@/stores/apiStore",
      "node:fs",
    ]) {
      expect(FORBIDDEN_SPECIFIER.test(specifier)).toBe(true);
    }
    for (const specifier of ["./providers", "vitest", "react"]) {
      expect(FORBIDDEN_SPECIFIER.test(specifier)).toBe(false);
    }
  });
});

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

describe("PROVIDER_ORDER / PROVIDER_LOG_LABELS / credential requirement maps", () => {
  it("PROVIDER_ORDER contains every provider id exactly once", () => {
    expect([...PROVIDER_ORDER].sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it("PROVIDER_LOG_LABELS has a display label for every provider", () => {
    for (const id of PROVIDER_IDS) {
      expect(typeof PROVIDER_LOG_LABELS[id]).toBe("string");
      expect(PROVIDER_LOG_LABELS[id].length).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// F3 — the operation every consumer needs, so it is not hand-rolled (wrongly)
// three more times. Every fixture below includes an UNTAGGED model, because
// `model.provider === provider` — the natural hand-rolled version — drops it.
// ---------------------------------------------------------------------------

describe("modelsForProvider", () => {
  const openaiModel: Model = { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" };
  const openrouterModel: Model = {
    id: "anthropic/claude-3",
    name: "claude-3",
    created: 1,
    provider: "openrouter",
  };
  const untaggedCloud: Model = { id: "legacy-model", name: "legacy-model", created: 1 };
  const untaggedLocal: Model = {
    id: "llama3.2:3b",
    name: "llama3.2",
    created: 1,
    local: { path: "llama3.2:3b" },
  };
  const taggedLocal: Model = {
    id: "custom-local",
    name: "custom-local",
    created: 1,
    provider: "ollama",
  };
  const models = [openaiModel, openrouterModel, untaggedCloud, untaggedLocal, taggedLocal];

  it("keeps an untagged cloud model in the openrouter slice", () => {
    expect(modelsForProvider(models, "openrouter")).toEqual([openrouterModel, untaggedCloud]);
  });

  it("keeps an untagged local model in the ollama slice", () => {
    expect(modelsForProvider(models, "ollama")).toEqual([untaggedLocal, taggedLocal]);
  });

  it("returns only exactly-tagged models for openai", () => {
    expect(modelsForProvider(models, "openai")).toEqual([openaiModel]);
  });

  it("preserves input order and returns a fresh array", () => {
    const slice = modelsForProvider(models, "openrouter");
    expect(slice).not.toBe(models);
    slice.pop();
    expect(models).toHaveLength(5);
  });

  it("agrees with isModelForProvider for every model/provider pair", () => {
    for (const provider of PROVIDER_ORDER) {
      const expected = models.filter((model) => isModelForProvider(model, provider));
      expect(modelsForProvider(models, provider)).toEqual(expected);
    }
  });
});

describe("groupModelsByProvider", () => {
  const untaggedCloud: Model = { id: "legacy-model", name: "legacy-model", created: 1 };
  const untaggedLocal: Model = {
    id: "llama3.2:3b",
    name: "llama3.2",
    created: 1,
    local: { path: "llama3.2:3b" },
  };
  const models = [untaggedCloud, untaggedLocal];

  it("emits one group per PROVIDER_ORDER entry, in order, by default", () => {
    expect(groupModelsByProvider(models).map((group) => group.provider)).toEqual([
      ...PROVIDER_ORDER,
    ]);
  });

  it("places untagged models in the group isModelForProvider says they belong to", () => {
    expect(groupModelsByProvider(models)).toEqual([
      { provider: "openai", models: [] },
      { provider: "openrouter", models: [untaggedCloud] },
      { provider: "ollama", models: [untaggedLocal] },
    ]);
  });

  it("honours a caller-supplied order and provider subset", () => {
    expect(groupModelsByProvider(models, ["ollama", "openrouter"])).toEqual([
      { provider: "ollama", models: [untaggedLocal] },
      { provider: "openrouter", models: [untaggedCloud] },
    ]);
  });

  it("keeps empty groups so callers decide whether to render them", () => {
    expect(groupModelsByProvider([], ["openai"])).toEqual([{ provider: "openai", models: [] }]);
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

  // F7 — the argument's real origin is a user-editable config file, so the
  // compile-time ProviderId is not a guarantee. An inherited Object.prototype
  // key must not read as a configured provider.
  it("rejects a prototype-chain key masquerading as a provider id", () => {
    const state = { hasApiKey: true, explicitlyEnabled: true };
    // Casts are the point of the test: they reproduce the untyped runtime value.
    expect(isProviderConfigured("constructor" as ProviderId, state)).toBe(false);
    expect(isProviderConfigured("__proto__" as ProviderId, state)).toBe(false);
    expect(isProviderConfigured("toString" as ProviderId, state)).toBe(false);
    expect(isProviderConfigured("valueOf" as ProviderId, state)).toBe(false);
    expect(isProviderConfigured("nope" as ProviderId, state)).toBe(false);
  });
});

// F7 — `readonly` / `Readonly<...>` are erased at runtime; a single unguarded
// `as` cast in any same-process consumer would corrupt the shared instance for
// every other importer. House precedent: `src/shared/features.ts` freezes its
// analogous map.
describe("exported collections are frozen at runtime", () => {
  it("freezes every exported provider collection", () => {
    expect(Object.isFrozen(PROVIDER_IDS)).toBe(true);
    expect(Object.isFrozen(PROVIDER_ORDER)).toBe(true);
    expect(Object.isFrozen(PROVIDER_LOG_LABELS)).toBe(true);
    expect(Object.isFrozen(PROVIDER_REQUIRES_API_KEY)).toBe(true);
    expect(Object.isFrozen(PROVIDER_SUPPORTS_PROVISIONING_KEY)).toBe(true);
  });

  it("a cast-and-push against PROVIDER_ORDER cannot corrupt the shared instance", () => {
    const before = [...PROVIDER_ORDER];
    // Deliberate unsound cast — this is exactly the unguarded call the freeze
    // is there to stop.
    expect(() => (PROVIDER_ORDER as ProviderId[]).push("ollama")).toThrow();
    expect([...PROVIDER_ORDER]).toEqual(before);
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
