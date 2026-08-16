import { describe, expect, it } from "vitest";
import {
  formatModelRef,
  isModelRef,
  modelRefForModel,
  parseModelRef,
  resolveModelRef,
  resolveProviderForModelRef,
  stripModelRefPrefix,
} from "./modelRef";
import { PROVIDER_IDS, type Model, type ProviderId } from "./providers";

describe("parseModelRef", () => {
  it("splits a known-provider prefix from the raw model id", () => {
    expect(parseModelRef("openrouter::openai/gpt-4o")).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-4o",
      raw: "openrouter::openai/gpt-4o",
    });
  });

  it("preserves the ollama tag suffix (`:3b`) untouched — splits on the first `::` only", () => {
    expect(parseModelRef("ollama::llama3.2:3b")).toEqual({
      provider: "ollama",
      modelId: "llama3.2:3b",
      raw: "ollama::llama3.2:3b",
    });
  });

  it("treats a bare id with no `::` as provider-less", () => {
    expect(parseModelRef("gpt-4o")).toEqual({
      provider: null,
      modelId: "gpt-4o",
      raw: "gpt-4o",
    });
  });

  it("treats an unknown prefix as part of the bare id, not a provider split", () => {
    expect(parseModelRef("bogus::x")).toEqual({
      provider: null,
      modelId: "bogus::x",
      raw: "bogus::x",
    });
  });

  // Kills a `lastIndexOf` regression: the head would be "openai::ollama", so the
  // whole string would degrade to a bare id.
  it("splits on the FIRST `::` when the value contains two — the tail keeps its own `::`", () => {
    expect(parseModelRef("openai::ollama::llama3.2:3b")).toEqual({
      provider: "openai",
      modelId: "ollama::llama3.2:3b",
      raw: "openai::ollama::llama3.2:3b",
    });
  });

  it("treats empty, null, and undefined as the inherit sentinel", () => {
    const expected = { provider: null, modelId: "", raw: "" };
    expect(parseModelRef("")).toEqual(expected);
    expect(parseModelRef(null)).toEqual(expected);
    expect(parseModelRef(undefined)).toEqual(expected);
  });

  it("round-trips formatModelRef -> parseModelRef for every provider", () => {
    for (const provider of PROVIDER_IDS) {
      const ref = formatModelRef(provider, "some-model-id");
      const parsed = parseModelRef(ref);
      expect(parsed.provider).toBe(provider);
      expect(parsed.modelId).toBe("some-model-id");
    }
  });
});

describe("stripModelRefPrefix", () => {
  const cases = [
    "openrouter::openai/gpt-4o",
    "ollama::llama3.2:3b",
    "gpt-4o",
    "bogus::x",
    "",
  ];

  it("reaches a fixed point after one pass for every well-formed ref in the parseModelRef matrix", () => {
    for (const value of cases) {
      const once = stripModelRefPrefix(value);
      const twice = stripModelRefPrefix(once);
      expect(twice).toBe(once);
    }
  });

  it("is a no-op on a bare id (no known provider prefix)", () => {
    expect(stripModelRefPrefix("gpt-4o")).toBe("gpt-4o");
    expect(stripModelRefPrefix("bogus::x")).toBe("bogus::x");
  });

  it("strips a known-provider prefix", () => {
    expect(stripModelRefPrefix("openai::gpt-4o")).toBe("gpt-4o");
  });

  // Kills a looping strip, which would silently accept a nested ref that
  // resolveModelRef, makeAIRequest and the picker all reject.
  it("removes exactly one prefix from a nested ref, leaving the inner ref intact", () => {
    expect(stripModelRefPrefix("openai::ollama::llama3.2:3b")).toBe("ollama::llama3.2:3b");
    expect(stripModelRefPrefix("openai::openai::gpt-4o")).toBe("openai::gpt-4o");
  });

  it("is deliberately NOT a fixed point on a nested ref — single-pass, no loop", () => {
    const nested = "openai::ollama::llama3.2:3b";
    const once = stripModelRefPrefix(nested);
    expect(stripModelRefPrefix(once)).toBe("llama3.2:3b");
    expect(stripModelRefPrefix(once)).not.toBe(once);
  });
});

describe("formatModelRef preconditions", () => {
  const models: Model[] = [
    { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openrouter" },
  ];

  it("does not normalize an already-prefixed modelId — it nests, and the nested ref is unresolvable", () => {
    const nested = formatModelRef("openai", "openrouter::gpt-4o");
    expect(nested).toBe("openai::openrouter::gpt-4o");
    expect(resolveModelRef(nested, models)).toBeNull();
  });

  it("does not throw on an already-prefixed modelId — the guard belongs at the call site", () => {
    expect(() => formatModelRef("openai", "openrouter::gpt-4o")).not.toThrow();
  });

  it("the documented caller guard `isModelRef(v) ? v : formatModelRef(p, v)` never nests", () => {
    const prefix = (value: string): string =>
      isModelRef(value) ? value : formatModelRef("openrouter", value);

    expect(prefix("gpt-4o")).toBe("openrouter::gpt-4o");
    expect(prefix("openrouter::gpt-4o")).toBe("openrouter::gpt-4o");
    expect(prefix(prefix("gpt-4o"))).toBe("openrouter::gpt-4o");
    expect(resolveModelRef(prefix(prefix("gpt-4o")), models)?.model).toBe(models[0]);
  });
});

describe("isModelRef", () => {
  it("is true only when a known provider prefix is present", () => {
    expect(isModelRef("openai::gpt-4o")).toBe(true);
    expect(isModelRef("bogus::x")).toBe(false);
    expect(isModelRef("gpt-4o")).toBe(false);
    expect(isModelRef("")).toBe(false);
  });
});

describe("modelRefForModel", () => {
  it("formats using the model's tagged provider", () => {
    const model: Model = { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" };
    expect(modelRefForModel(model)).toBe("openai::gpt-4o");
  });

  it("falls back to openrouter when the model has no provider tag", () => {
    const model: Model = { id: "legacy-model", name: "legacy-model", created: 1 };
    expect(modelRefForModel(model)).toBe("openrouter::legacy-model");
  });

  it("attributes an untagged local model to ollama, not to the openrouter fallback", () => {
    const model: Model = {
      id: "llama3.2:3b",
      name: "llama3.2",
      created: 1,
      local: { path: "llama3.2:3b", size: 100 },
    };
    expect(modelRefForModel(model)).toBe("ollama::llama3.2:3b");
  });

  it("prefers the earliest PROVIDER_ORDER match when a model matches two providers", () => {
    // An openai tag plus a local descriptor matches both openai and ollama.
    const model: Model = {
      id: "gpt-4o",
      name: "gpt-4o",
      created: 1,
      provider: "openai",
      local: { path: "/models/gpt-4o" },
    };
    expect(modelRefForModel(model)).toBe("openai::gpt-4o");
    expect(resolveModelRef(modelRefForModel(model), [model])?.model).toBe(model);
  });

  it("falls back to providerOfModel for a cache entry whose provider tag is unrecognized", () => {
    // The result must degrade to an unresolvable bare id, never to another provider.
    const model: Model = {
      id: "x",
      name: "x",
      created: 1,
      provider: "not-a-provider" as ProviderId,
    };
    expect(modelRefForModel(model)).toBe("not-a-provider::x");
    expect(parseModelRef(modelRefForModel(model)).provider).toBeNull();
    expect(resolveModelRef(modelRefForModel(model), [model])).toBeNull();
  });

  it("returns the inherit sentinel for a model with an empty id", () => {
    expect(modelRefForModel({ id: "", name: "", created: 1, provider: "openai" })).toBe("");
  });
});

describe("modelRefForModel / resolveModelRef round trip", () => {
  const shapes: { label: string; model: Model; provider: string }[] = [
    {
      label: "tagged cloud",
      model: { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
      provider: "openai",
    },
    {
      label: "tagged local",
      model: { id: "custom-local", name: "custom-local", created: 1, provider: "ollama" },
      provider: "ollama",
    },
    {
      label: "untagged local",
      model: {
        id: "llama3.2:3b",
        name: "llama3.2",
        created: 1,
        local: { path: "llama3.2:3b", size: 100 },
      },
      provider: "ollama",
    },
    {
      label: "untagged cloud",
      model: { id: "legacy-model", name: "legacy-model", created: 1 },
      provider: "openrouter",
    },
  ];

  for (const { label, model, provider } of shapes) {
    it(`round-trips a ${label} model`, () => {
      const ref = modelRefForModel(model);
      const resolved = resolveModelRef(ref, [model]);
      expect(resolved).not.toBeNull();
      expect(resolved?.provider).toBe(provider);
      expect(resolved?.model).toBe(model);
      expect(resolved?.ref).toBe(ref);
    });

    it(`agrees with the bare-id scan for a ${label} model`, () => {
      expect(resolveModelRef(model.id, [model])?.provider).toBe(provider);
    });
  }
});

describe("formatModelRef", () => {
  it("returns the inherit sentinel for an empty model id rather than a degenerate `<provider>::`", () => {
    for (const provider of PROVIDER_IDS) {
      expect(formatModelRef(provider, "")).toBe("");
    }
  });
});

describe("resolveModelRef", () => {
  const openaiModel: Model = { id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" };
  const openrouterModel: Model = {
    id: "shared-id",
    name: "shared-id (openrouter)",
    created: 1,
    provider: "openrouter",
  };
  const ollamaModel: Model = {
    id: "shared-id",
    name: "shared-id (ollama)",
    created: 1,
    provider: "ollama",
  };
  const models = [openaiModel, openrouterModel, ollamaModel];

  it("returns the exact (provider, id) match for a prefixed ref", () => {
    const result = resolveModelRef("openai::gpt-4o", models);
    expect(result).toEqual({
      provider: "openai",
      model: openaiModel,
      ref: "openai::gpt-4o",
    });
  });

  it("returns null for a prefixed ref whose id is absent from the cache", () => {
    expect(resolveModelRef("openai::ghost", models)).toBeNull();
  });

  // "gpt-4o" IS in this cache under openai, so a widened candidate list would
  // return the openai row for an ollama ref and bill the OpenAI key.
  it("returns null for a prefixed ref whose id exists only under a DIFFERENT provider", () => {
    expect(resolveModelRef("ollama::gpt-4o", models)).toBeNull();
    expect(resolveModelRef("openai::shared-id", models)).toBeNull();
  });

  // If a display-order change fails this, split the two concerns rather than
  // updating the expectation — PROVIDER_ORDER is also billing precedence.
  it("bills a bare id to the earliest PROVIDER_ORDER provider that has it — a reorder reroutes it", () => {
    // "shared-id" exists under both openrouter (paid) and ollama (local).
    const result = resolveModelRef("shared-id", models);
    expect(result?.provider).toBe("openrouter");
    expect(result?.model).toBe(openrouterModel);
    expect(result?.ref).toBe("openrouter::shared-id");
  });

  it("returns null for the empty-string inherit sentinel", () => {
    expect(resolveModelRef("", models)).toBeNull();
  });

  it("returns null when no model matches at all", () => {
    expect(resolveModelRef("nope-not-here", models)).toBeNull();
  });
});

describe("resolveProviderForModelRef", () => {
  const models: Model[] = [
    { id: "gpt-4o", name: "GPT-4o", created: 0, provider: "openai" },
    { id: "openai/gpt-4o", name: "GPT-4o", created: 0, provider: "openrouter" },
    { id: "llama3.2:3b", name: "Llama 3.2 3B", created: 0, local: { path: "/models/llama3.2" } },
  ];

  it("resolves an explicit provider prefix against the cached model list", () => {
    expect(resolveProviderForModelRef("openai::gpt-4o", models)).toBe("openai");
    expect(resolveProviderForModelRef("openrouter::openai/gpt-4o", models)).toBe("openrouter");
  });

  it("resolves a bare id by scanning provider order against the cache", () => {
    expect(resolveProviderForModelRef("gpt-4o", models)).toBe("openai");
  });

  it("resolves a local provider ref (ollama) so callers can decide to skip it", () => {
    expect(resolveProviderForModelRef("ollama::llama3.2:3b", models)).toBe("ollama");
  });

  it("falls back to the ref's own prefix when the model cache has no match yet", () => {
    // An explicit prefix names its provider even before that provider's model
    // list has ever been fetched — must not silently disable prewarming.
    expect(resolveProviderForModelRef("openai::some-new-model", [])).toBe("openai");
  });

  it("returns null for a bare id with no cache match and no prefix", () => {
    expect(resolveProviderForModelRef("totally-unknown-model", [])).toBeNull();
  });

  it("returns null for the empty (inherit) ref", () => {
    expect(resolveProviderForModelRef("", models)).toBeNull();
  });
});
