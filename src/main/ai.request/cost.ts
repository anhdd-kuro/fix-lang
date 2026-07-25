/**
 * @file cost.ts
 * @description PURE cost-snapshot logic for correction history (#56).
 *
 * Computes an estimated USD cost for a served model + token counts, by matching
 * the model id against OpenRouter per-token pricing (built from the already
 * cached `/api/v1/models` `Model[]`). Matching is exact-then-fuzzy (fuse.js),
 * preferring `resolvedModel` over `model`. Local/Ollama usage is always $0.
 *
 * Honesty rules (load-bearing, enforced by `cost_status`):
 * - Local/Ollama  → status "zero", cost 0 (renders "$0.00", never "N/A").
 * - No confident price match / unpriced / parse failure → status "na",
 *   cost null (renders "N/A", NEVER "$0" and NEVER a fabricated number).
 * - Confident match → status "ok", cost computed from the snapshot prices.
 *
 * Electron-free and side-effect-free so it can be unit-tested directly.
 */
import Fuse from "fuse.js";
import type { Model, ProviderId } from "~/stores/apiStore";

/** Per-token USD prices (OpenRouter strings) keyed by lowercased model id. */
export type PriceMap = Map<string, { prompt: string; completion: string }>;

export type CostInput = {
  /** Provider that served the request. Direct OpenAI has no local price map. */
  provider?: ProviderId;
  model?: string;
  resolvedModel?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** True when the served model ran locally (Ollama) — always $0. */
  isLocal?: boolean;
};

export type CostStatus = "ok" | "zero" | "na";

export type CostSnapshot = {
  status: CostStatus;
  estimatedCostUsd: number | null;
  pricePrompt: string | null;
  priceCompletion: string | null;
};

/**
 * Fuse score is 0 (perfect) → 1 (worst). A conservative threshold keeps weak
 * matches from mispricing — anything above this falls back to N/A (HITL #5).
 */
export const FUZZY_SCORE_THRESHOLD = 0.3;

const NA: CostSnapshot = {
  status: "na",
  estimatedCostUsd: null,
  pricePrompt: null,
  priceCompletion: null,
};

/**
 * Build a price map from the already-fetched `Model[]`. Models without
 * `pricing` are skipped (they can't be priced). Keyed by lowercased id.
 */
export const buildPriceMap = (models: Model[]): PriceMap => {
  const map: PriceMap = new Map();
  for (const model of models) {
    if (model.pricing) {
      map.set(model.id.toLowerCase(), {
        prompt: model.pricing.prompt,
        completion: model.pricing.completion,
      });
    }
  }
  return map;
};

/**
 * Normalize a model id for matching: strip the provider prefix (everything up
 * to and including the first `/`), lowercase, trim.
 * e.g. "OpenAI/GPT-5.4-mini" → "gpt-5.4-mini".
 */
export const normalizeModelId = (id: string): string => {
  const trimmed = id.trim();
  const slash = trimmed.indexOf("/");
  const withoutPrefix = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return withoutPrefix.toLowerCase().trim();
};

/** Parse an OpenRouter price string to a finite number, or null. */
const parsePrice = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * Resolve the priced entry for a served id: exact (lowercased) match first,
 * then a normalized-key fuzzy match via fuse.js under the score threshold.
 * Returns the matched price pair, or null when nothing is confident enough.
 */
const matchPrice = (
  servedId: string,
  priceMap: PriceMap
): { prompt: string; completion: string } | null => {
  const lower = servedId.toLowerCase();
  const exact = priceMap.get(lower);
  if (exact) {
    return exact;
  }

  // Fuzzy over normalized keys (prefix-stripped) to absorb provider-prefix and
  // casing differences without guessing across genuinely different models.
  const candidates = [...priceMap.keys()].map((key) => ({
    key,
    normalized: normalizeModelId(key),
  }));
  const fuse = new Fuse(candidates, {
    keys: ["normalized"],
    includeScore: true,
    threshold: FUZZY_SCORE_THRESHOLD,
    ignoreLocation: true,
  });

  const [best] = fuse.search(normalizeModelId(servedId));
  if (best && best.score !== undefined && best.score <= FUZZY_SCORE_THRESHOLD) {
    return priceMap.get(best.item.key) ?? null;
  }
  return null;
};

/**
 * Compute the cost snapshot for a served model + token counts. See the file
 * header for the honesty rules. Never throws.
 */
export const computeCost = (
  input: CostInput,
  priceMap: PriceMap
): CostSnapshot => {
  // Direct OpenAI model discovery intentionally has no pricing. Do not fuzzy
  // match its bare model ids against the OpenRouter catalogue.
  if (input.provider === "openai") {
    return NA;
  }

  // 1. Local/Ollama short-circuits to $0 regardless of any fuzzy price.
  if (input.isLocal) {
    return {
      status: "zero",
      estimatedCostUsd: 0,
      pricePrompt: null,
      priceCompletion: null,
    };
  }

  // 2. Prefer the resolved (served) id over the requested model.
  const servedId = (input.resolvedModel ?? input.model ?? "").trim();
  if (servedId.length === 0) {
    return NA;
  }

  // 3. Exact-then-fuzzy match.
  const matched = matchPrice(servedId, priceMap);
  if (!matched) {
    return NA;
  }

  // 4. Parse prices; any parse failure → N/A (never fabricate).
  const pricePrompt = parsePrice(matched.prompt);
  const priceCompletion = parsePrice(matched.completion);
  if (pricePrompt === null || priceCompletion === null) {
    return NA;
  }

  // 5. Compute. Missing token counts default to 0.
  const promptTokens = input.promptTokens ?? 0;
  const completionTokens = input.completionTokens ?? 0;
  const estimatedCostUsd =
    promptTokens * pricePrompt + completionTokens * priceCompletion;

  return {
    status: "ok",
    estimatedCostUsd,
    pricePrompt: matched.prompt,
    priceCompletion: matched.completion,
  };
};
