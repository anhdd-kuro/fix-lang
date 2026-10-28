/**
 * @file models.test.ts
 * @description Pins how the live OpenRouter model list is normalized: which
 * rows survive, which fields fall back, and that the raw row (prices included)
 * rides along untouched.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenRouterModels, normalizeOpenRouterModels } from "./models";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeOpenRouterModels", () => {
  it("returns nothing when the list is not an array", () => {
    expect(normalizeOpenRouterModels(undefined)).toEqual([]);
    expect(normalizeOpenRouterModels(null)).toEqual([]);
    expect(normalizeOpenRouterModels({ id: "a" })).toEqual([]);
  });

  it("drops rows that are not objects or carry no non-empty string id", () => {
    const models = normalizeOpenRouterModels([
      null,
      "openai/gpt",
      7,
      ["openai/gpt"],
      {},
      { id: "" },
      { id: 42 },
      { id: "openai/gpt" },
    ]);

    expect(models.map((model) => model.id)).toEqual(["openai/gpt"]);
  });

  it("keeps the raw row and falls back for a missing name or created", () => {
    const [model] = normalizeOpenRouterModels([
      {
        name: 3,
        id: "openai/gpt",
        created: "1700000000",
        pricing: { prompt: "0.000001" },
        provider: "openai",
      },
    ]);

    expect(model).toEqual({
      name: "openai/gpt",
      id: "openai/gpt",
      created: 0,
      pricing: { prompt: "0.000001" },
      provider: "openrouter",
    });
    expect(Object.keys(model)).toEqual([
      "name",
      "id",
      "created",
      "pricing",
      "provider",
    ]);
  });
});

describe("fetchOpenRouterModels", () => {
  it("fails on a null body rather than reporting an empty catalogue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => null })),
    );

    await expect(fetchOpenRouterModels("sk-or-test")).rejects.toThrow(
      TypeError,
    );
  });
});
