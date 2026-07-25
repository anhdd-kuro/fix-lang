/**
 * @file modelRef.test.ts
 * @description Tests for the composite model-ref kernel:
 * `<providerId>::<rawModelId>` parse / format / strip / resolve.
 */
import { describe, expect, it } from "vitest";
import {
  formatModelRef,
  isModelRef,
  modelRefForModel,
  parseModelRef,
  resolveModelRef,
  stripModelRefPrefix,
} from "./modelRef";
import { PROVIDER_IDS, type Model } from "./providers";

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

  it("is idempotent for every case in the parseModelRef matrix", () => {
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

  it("scans PROVIDER_ORDER for a bare id and returns the first hit", () => {
    // "shared-id" exists under both openrouter and ollama; PROVIDER_ORDER is
    // ["openai", "openrouter", "ollama"], so openrouter must win.
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
