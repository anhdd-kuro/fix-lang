/**
 * @file cost.test.ts
 * @description Unit tests for the PURE cost module (#56). No electron — uses
 * fixture price maps. Real per-model accuracy depends on a live OpenRouter
 * price fetch; these fixtures only exercise the matching/compute logic.
 */
import { describe, expect, it } from "vitest";
import {
  buildPriceMap,
  computeCost,
  normalizeModelId,
  type PriceMap,
} from "./cost";
import type { Model } from "~/stores/apiStore";

// Fixture: prompt $0.000002/token, completion $0.000008/token for gpt-4o.
const priceMap: PriceMap = new Map([
  ["openai/gpt-4o", { prompt: "0.000002", completion: "0.000008" }],
  ["anthropic/claude-3.5-sonnet", { prompt: "0.000003", completion: "0.000015" }],
]);

describe("buildPriceMap", () => {
  it("keeps only models with pricing, keyed by lowercased id", () => {
    const models: Model[] = [
      {
        id: "OpenAI/GPT-4o",
        name: "GPT-4o",
        created: 0,
        pricing: {
          prompt: "0.000002",
          completion: "0.000008",
          image: "0",
          request: "0",
          input_cache_read: "0",
          input_cache_write: "0",
          web_search: "0",
          internal_reasoning: "0",
        },
      },
      // No pricing → skipped.
      { id: "local/llama3", name: "Llama 3", created: 0 },
    ];
    const map = buildPriceMap(models);
    expect(map.size).toBe(1);
    expect(map.has("openai/gpt-4o")).toBe(true);
    expect(map.has("local/llama3")).toBe(false);
  });
});

describe("normalizeModelId", () => {
  it("strips the provider prefix, lowercases, and trims", () => {
    expect(normalizeModelId("OpenAI/GPT-5.4-Mini")).toBe("gpt-5.4-mini");
    expect(normalizeModelId("  anthropic/Claude-3.5-Sonnet  ")).toBe(
      "claude-3.5-sonnet"
    );
  });
  it("leaves a prefix-less id unchanged (lowercased)", () => {
    expect(normalizeModelId("Llama3")).toBe("llama3");
  });
});

describe("computeCost", () => {
  it("returns N/A for direct OpenAI even when an OpenRouter price match exists", () => {
    const result = computeCost(
      {
        provider: "openai",
        resolvedModel: "gpt-4o",
        promptTokens: 1000,
        completionTokens: 500,
      },
      buildPriceMap([
        { id: "openai/gpt-4o", name: "GPT-4o", created: 0, pricing: { prompt: "0.000002", completion: "0.000008", image: "0", request: "0", input_cache_read: "0", input_cache_write: "0", web_search: "0", internal_reasoning: "0" } },
      ]),
    );
    expect(result).toMatchObject({ status: "na", estimatedCostUsd: null });
  });
  it("computes a confident exact match in USD with the prices used", () => {
    const result = computeCost(
      { resolvedModel: "openai/gpt-4o", promptTokens: 1000, completionTokens: 500 },
      priceMap
    );
    expect(result.status).toBe("ok");
    // 1000*0.000002 + 500*0.000008 = 0.002 + 0.004 = 0.006
    expect(result.estimatedCostUsd).toBeCloseTo(0.006, 10);
    expect(result.pricePrompt).toBe("0.000002");
    expect(result.priceCompletion).toBe("0.000008");
  });

  it("records Ollama/local as $0 (zero), prices null — even if a price exists", () => {
    const result = computeCost(
      { model: "openai/gpt-4o", isLocal: true, promptTokens: 1000 },
      priceMap
    );
    expect(result.status).toBe("zero");
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.pricePrompt).toBeNull();
    expect(result.priceCompletion).toBeNull();
  });

  it("records N/A for an unmatched model (never $0, never a guess)", () => {
    const result = computeCost(
      { resolvedModel: "totally-unknown-xyz-9000", promptTokens: 100 },
      priceMap
    );
    expect(result.status).toBe("na");
    expect(result.estimatedCostUsd).toBeNull();
    expect(result.pricePrompt).toBeNull();
  });

  it("prefers resolvedModel over model for matching", () => {
    const result = computeCost(
      {
        model: "~alias/floating-latest",
        resolvedModel: "openai/gpt-4o",
        promptTokens: 1000,
        completionTokens: 0,
      },
      priceMap
    );
    expect(result.status).toBe("ok");
    expect(result.pricePrompt).toBe("0.000002");
  });

  it("fuzzy-matches a prefix/case variant of a priced id", () => {
    // Different provider prefix + casing, same model → should match gpt-4o.
    const result = computeCost(
      { resolvedModel: "OpenRouter/GPT-4o", promptTokens: 1000, completionTokens: 0 },
      priceMap
    );
    expect(result.status).toBe("ok");
    expect(result.priceCompletion).toBe("0.000008");
  });

  it("falls below the fuzzy threshold for a sufficiently different id → N/A", () => {
    const result = computeCost(
      { resolvedModel: "openai/some-completely-different-model", promptTokens: 1 },
      priceMap
    );
    expect(result.status).toBe("na");
  });

  it("defaults missing token counts to 0 (still ok when priced)", () => {
    const result = computeCost({ resolvedModel: "openai/gpt-4o" }, priceMap);
    expect(result.status).toBe("ok");
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.pricePrompt).toBe("0.000002");
  });

  it("returns N/A when neither model nor resolvedModel is present", () => {
    expect(computeCost({ promptTokens: 100 }, priceMap).status).toBe("na");
  });

  it("returns N/A when the matched price string is unparseable", () => {
    const badMap: PriceMap = new Map([
      ["openai/gpt-4o", { prompt: "not-a-number", completion: "0.000008" }],
    ]);
    expect(
      computeCost({ resolvedModel: "openai/gpt-4o", promptTokens: 10 }, badMap)
        .status
    ).toBe("na");
  });
});

// ---------------------------------------------------------------------------
// D20 — composite model refs must price identically to the raw id
//
// This is the second SILENT regression of the refactor: a composite ref misses
// the exact `priceMap.get(...)` lookup and lands in fuzzy matching, which
// MIS-PRICES rather than erroring. So every assertion below is `toEqual` the
// raw-id snapshot, never a hand-written number — a literal would keep passing
// if the fuzzy fallback happened to land on the right row today and the wrong
// one tomorrow.
//
// The `decoyMap` is what separates "exact" from "fuzzy". Both of its keys
// normalize to "gpt-4o", and the DECOY IS FIRST, so the fuzzy path returns the
// decoy's prices. Getting the openai/ row back is therefore proof the exact
// lookup ran; getting the azure/ row back is proof it fell through.
// ---------------------------------------------------------------------------

describe("computeCost — composite model refs (D20)", () => {
  const decoyMap: PriceMap = new Map([
    // Deliberately first: fuse.js scans keys in insertion order and both keys
    // normalize to the same string, so this is the row fuzzy matching returns.
    ["azure/gpt-4o", { prompt: "0.000999", completion: "0.000999" }],
    ["openai/gpt-4o", { prompt: "0.000002", completion: "0.000008" }],
  ]);

  const sameAsRaw = (raw: string, ref: string, map: PriceMap = priceMap) => {
    const tokens = { promptTokens: 1000, completionTokens: 500 };
    expect(computeCost({ resolvedModel: ref, ...tokens }, map)).toEqual(
      computeCost({ resolvedModel: raw, ...tokens }, map),
    );
  };

  it("prices an openrouter:: ref exactly as the raw id", () => {
    sameAsRaw("openai/gpt-4o", "openrouter::openai/gpt-4o");
  });

  it("uses the EXACT lookup, not fuzzy, for an openrouter:: ref", () => {
    const result = computeCost(
      { resolvedModel: "openrouter::openai/gpt-4o", promptTokens: 1000 },
      decoyMap,
    );
    expect(result.status).toBe("ok");
    // The exact row. If the ref had fallen through to fuzzy this would be
    // "0.000999" — a 500x overcharge, reported as a confident "ok".
    expect(result.pricePrompt).toBe("0.000002");
    expect(result.priceCompletion).toBe("0.000008");
    // …and it is the same snapshot the raw id produces.
    expect(result).toEqual(
      computeCost({ resolvedModel: "openai/gpt-4o", promptTokens: 1000 }, decoyMap),
    );
  });

  it("the decoy map really does discriminate — fuzzy returns the decoy row", () => {
    // Guards the test above against becoming vacuous: an id that can only be
    // reached by fuzzy matching must come back with the decoy's prices. If
    // this ever starts returning "0.000002", the exactness assertion above is
    // no longer proving anything and both need rebuilding.
    const fuzzyOnly = computeCost(
      { resolvedModel: "GPT-4o", promptTokens: 1000 },
      decoyMap,
    );
    expect(fuzzyOnly.status).toBe("ok");
    expect(fuzzyOnly.pricePrompt).toBe("0.000999");
  });

  it("prices an openai:: ref to a prefixed id exactly as the raw id", () => {
    sameAsRaw("openai/gpt-4o", "openai::openai/gpt-4o", decoyMap);
  });

  it("prices an anthropic model behind an openrouter:: ref as the raw id", () => {
    sameAsRaw("anthropic/claude-3.5-sonnet", "openrouter::anthropic/claude-3.5-sonnet");
  });

  it("prices an ollama:: ref to a colon-tagged id as the raw id", () => {
    // `::` splits once, so the tag's own ":" survives. This id has no "/", so
    // `normalizeModelId` alone would leave the whole "ollama::…" string as the
    // fuzzy key.
    const taggedMap: PriceMap = new Map([
      ["llama3.2:3b", { prompt: "0.000001", completion: "0.000004" }],
    ]);
    sameAsRaw("llama3.2:3b", "ollama::llama3.2:3b", taggedMap);
    expect(
      computeCost({ resolvedModel: "ollama::llama3.2:3b", promptTokens: 1000 }, taggedMap)
        .pricePrompt,
    ).toBe("0.000001");
  });

  it("an unmatched composite ref is still N/A, never a fabricated price", () => {
    sameAsRaw("totally-unknown-xyz-9000", "openrouter::totally-unknown-xyz-9000");
    expect(
      computeCost(
        { resolvedModel: "openrouter::totally-unknown-xyz-9000", promptTokens: 100 },
        priceMap,
      ).status,
    ).toBe("na");
  });

  it("a composite ref in `model` (not `resolvedModel`) prices the same too", () => {
    expect(
      computeCost({ model: "openrouter::openai/gpt-4o", promptTokens: 1000 }, decoyMap),
    ).toEqual(computeCost({ model: "openai/gpt-4o", promptTokens: 1000 }, decoyMap));
  });
});

describe("normalizeModelId — composite model refs (D20)", () => {
  it("strips the provider prefix before the slash-prefix rule", () => {
    expect(normalizeModelId("openrouter::OpenAI/GPT-4o")).toBe(
      normalizeModelId("OpenAI/GPT-4o"),
    );
  });

  it("strips it for a slash-less Ollama tag too", () => {
    expect(normalizeModelId("ollama::Llama3.2:3b")).toBe(
      normalizeModelId("Llama3.2:3b"),
    );
  });

  it("leaves an unrecognized head alone — it is not a provider prefix", () => {
    expect(normalizeModelId("bogus::llama3")).toBe("bogus::llama3");
  });
});

describe("buildPriceMap — composite model refs (D20)", () => {
  // Defensive only. Every `Model` the app caches carries a RAW id — the
  // composite ref lives in `selectedModel`/preset `model` fields, never in
  // `Model.id`. Keying on the stripped id costs nothing and means a cache
  // entry corrupted by a future writer prices correctly instead of creating a
  // key no served id can ever match.
  it("keys on the raw id even if a cached entry arrives prefixed", () => {
    const pricing = {
      prompt: "0.000002",
      completion: "0.000008",
      image: "0",
      request: "0",
      input_cache_read: "0",
      input_cache_write: "0",
      web_search: "0",
      internal_reasoning: "0",
    };
    const models: Model[] = [
      { id: "openrouter::openai/gpt-4o", name: "GPT-4o", created: 0, pricing },
    ];
    const map = buildPriceMap(models);
    expect(map.has("openai/gpt-4o")).toBe(true);
    expect(map.has("openrouter::openai/gpt-4o")).toBe(false);
  });
});
