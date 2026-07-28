/**
 * @file models.ts
 * @description Live OpenRouter model list. Moved verbatim from
 * `ai.request/shared.ts` — the cache, freshness stamping and strict/fallback
 * policy stay there; this module only performs the fetch and normalization.
 */
import type { Model } from "~/shared/providers";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const TIMEOUT_MS = 5000;

/**
 * Drop entries without a usable id rather than throwing: one malformed row must
 * not cost the user the whole model list. OpenRouter's price fields ride along on
 * purpose — they are what `buildPriceMap` costs requests with.
 */
export const normalizeOpenRouterModels = (data: unknown): Model[] => {
  if (!Array.isArray(data)) return [];
  return data.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Partial<Model>;
    if (!raw.id || typeof raw.id !== "string") return [];
    return [{
      ...raw,
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name : raw.id,
      created: typeof raw.created === "number" ? raw.created : 0,
      provider: "openrouter",
    } satisfies Model];
  });
};

export const fetchOpenRouterModels = async (apiKey: string): Promise<Model[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }
    const payload = (await response.json()) as { data?: unknown };
    return normalizeOpenRouterModels(payload.data);
  } finally {
    clearTimeout(timeoutId);
  }
};
