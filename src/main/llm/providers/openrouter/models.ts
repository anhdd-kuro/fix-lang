/**
 * @file models.ts
 * @description Live OpenRouter model list. Moved verbatim from
 * `ai.request/shared.ts` — the cache, freshness stamping and strict/fallback
 * policy stay there; this module only performs the fetch and normalization.
 */
import { z } from "zod";
import type { Model } from "~/features/providers/shared/providers";
import { isJsonObject, jsonField, type JsonValue } from "~/main/jsonValue";

const ModelIdSchema = z.string().min(1);
const ModelNameSchema = z.string();
const ModelCreatedSchema = z.number();

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const TIMEOUT_MS = 5000;

/**
 * Drop entries without a usable id rather than throwing: one malformed row must
 * not cost the user the whole model list. OpenRouter's price fields ride along on
 * purpose — they are what `buildPriceMap` costs requests with.
 */
export const normalizeOpenRouterModels = (
  data: JsonValue | undefined,
): Model[] => {
  if (!Array.isArray(data)) return [];
  return data.flatMap((candidate) => {
    if (!isJsonObject(candidate)) return [];
    const id = ModelIdSchema.safeParse(candidate.id);
    if (!id.success) return [];
    const name = ModelNameSchema.safeParse(candidate.name);
    const created = ModelCreatedSchema.safeParse(candidate.created);
    return [
      {
        ...candidate,
        id: id.data,
        name: name.success ? name.data : id.data,
        created: created.success ? created.data : 0,
        provider: "openrouter",
      },
    ];
  });
};

export const fetchOpenRouterModels = async (
  apiKey: string,
): Promise<Model[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `API returned ${response.status}: ${response.statusText}`,
      );
    }
    const payload: JsonValue = await response.json();
    return normalizeOpenRouterModels(jsonField(payload, "data"));
  } finally {
    clearTimeout(timeoutId);
  }
};
