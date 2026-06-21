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
