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
import type { Model } from "~/features/providers/store/apiStore";

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
  it("returns N/A for direct Anthropic, whose ids fuzzy-match the WRONG OpenRouter entry", () => {
    // Measured, not hypothetical: without the short-circuit, `claude-opus-4-5`
    // matches `anthropic/claude-opus-4.1` under the threshold and is billed at
    // Opus 4.1's rate — 3x the real price, reported as `status: "ok"`. A
    // confidently wrong number is worse than N/A.
    const result = computeCost(
      {
        provider: "anthropic",
        resolvedModel: "claude-opus-4-5",
        promptTokens: 1000,
        completionTokens: 500,
      },
      new Map([
        ["anthropic/claude-opus-4.1", { prompt: "0.000015", completion: "0.000075" }],
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

  it("prices lmstudio provider usage as zero", () => {
    const snapshot = computeCost(
      { provider: "lmstudio", model: "local-model", promptTokens: 100, completionTokens: 50 },
      new Map(),
    );
    expect(snapshot).toEqual({
      status: "zero",
      estimatedCostUsd: 0,
      pricePrompt: null,
      priceCompletion: null,
    });
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

// A composite ref that misses the exact lookup lands in fuzzy matching, which
// MIS-PRICES rather than erroring — so assertions compare against the raw-id
// snapshot, never a hand-written number.

describe("computeCost — composite model refs", () => {
  const decoyMap: PriceMap = new Map([
    // Deliberately first: both keys normalize to "gpt-4o" and fuse.js scans in
    // insertion order, so getting this row back proves fuzzy matching ran.
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
    // Fuzzy would give "0.000999" — a 500x overcharge reported as a confident
    // "ok".
    expect(result.pricePrompt).toBe("0.000002");
    expect(result.priceCompletion).toBe("0.000008");
    expect(result).toEqual(
      computeCost({ resolvedModel: "openai/gpt-4o", promptTokens: 1000 }, decoyMap),
    );
  });

  it("the decoy map really does discriminate — fuzzy returns the decoy row", () => {
    // Guards the test above against becoming vacuous: if this starts returning
    // "0.000002", the exactness assertion proves nothing.
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
    // No "/", so `normalizeModelId` alone would keep the whole "ollama::…"
    // string as the fuzzy key.
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

describe("normalizeModelId — composite model refs", () => {
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

describe("buildPriceMap — composite model refs", () => {
  // Defensive only: cached `Model.id` values are raw in practice.
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

// `resolvedModel` is now the provider-reported served id, usually a dated
// variant. Exact lookups on served then requested must precede any fuzzy pass,
// or a dated id lands on a NEIGHBOURING dated row (or N/A) instead of the slug
// the catalogue prices.
describe("computeCost — served id vs requested id matching order", () => {
  const datedCatalogue: PriceMap = new Map([
    // Deliberately the neighbouring dated row, listed first and priced
    // differently, so a fuzzy hit on it is distinguishable.
    ["openai/gpt-4o-2024-08-06", { prompt: "0.000777", completion: "0.000777" }],
    ["openai/gpt-4o", { prompt: "0.000002", completion: "0.000008" }],
  ]);
  const tokens = { promptTokens: 1000, completionTokens: 500 };

  it("prices a dated served id at the requested slug, not a neighbouring dated row", () => {
    const result = computeCost(
      {
        model: "openai/gpt-4o",
        resolvedModel: "openai/gpt-4o-2024-11-20",
        ...tokens,
      },
      datedCatalogue,
    );
    expect(result.status).toBe("ok");
    expect(result.pricePrompt).toBe("0.000002");
    expect(result.priceCompletion).toBe("0.000008");
  });

  it("prices a dated served id at the requested slug when the catalogue holds no dated rows", () => {
    // Without the requested-id lookup this id falls below the fuzzy threshold
    // and the request, which used to price exactly, turns into N/A.
    const result = computeCost(
      {
        model: "openai/gpt-4o",
        resolvedModel: "openai/gpt-4o-2024-11-20",
        ...tokens,
      },
      priceMap,
    );
    expect(result).toMatchObject({ status: "ok", pricePrompt: "0.000002" });
  });

  it("lets an exact match on the served id beat the requested slug", () => {
    const result = computeCost(
      {
        model: "openai/gpt-4o",
        resolvedModel: "openai/gpt-4o-2024-08-06",
        ...tokens,
      },
      datedCatalogue,
    );
    expect(result.pricePrompt).toBe("0.000777");
  });

  it("matches the requested id exactly through a composite ref", () => {
    const result = computeCost(
      {
        model: "openrouter::openai/gpt-4o",
        resolvedModel: "openai/gpt-4o-2024-11-20",
        ...tokens,
      },
      datedCatalogue,
    );
    expect(result.pricePrompt).toBe("0.000002");
  });

  it("still fuzzy-matches the served id when neither id is an exact key", () => {
    const result = computeCost(
      {
        model: "gpt-4o-latest-alias",
        resolvedModel: "OpenRouter/GPT-4o",
        ...tokens,
      },
      priceMap,
    );
    expect(result).toMatchObject({ status: "ok", pricePrompt: "0.000002" });
  });

  describe("floating aliases", () => {
    const aliasCatalogue: PriceMap = new Map([
      ["~openai/gpt-mini-latest", { prompt: "0.0000004", completion: "0.0000016" }],
      ["openai/gpt-4o", { prompt: "0.000002", completion: "0.000008" }],
    ]);

    it("prices a catalogued alias at the alias row when the served id is a dated model", () => {
      const result = computeCost(
        {
          model: "~openai/gpt-mini-latest",
          resolvedModel: "openai/gpt-5-mini-2025-08-07",
          ...tokens,
        },
        aliasCatalogue,
      );
      expect(result).toMatchObject({ status: "ok", pricePrompt: "0.0000004" });
    });

    it("never invents a price for an uncatalogued alias whose served id matches nothing", () => {
      const result = computeCost(
        {
          model: "~openai/gpt-mini-latest",
          resolvedModel: "openai/gpt-5-mini-2025-08-07",
          ...tokens,
        },
        priceMap,
      );
      expect(result).toMatchObject({ status: "na", estimatedCostUsd: null });
    });

    it("prices an uncatalogued alias from its exactly catalogued served id", () => {
      const result = computeCost(
        {
          model: "~openai/gpt-latest",
          resolvedModel: "openai/gpt-4o",
          ...tokens,
        },
        aliasCatalogue,
      );
      expect(result).toMatchObject({ status: "ok", pricePrompt: "0.000002" });
    });
  });
});
