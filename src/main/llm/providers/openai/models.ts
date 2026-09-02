/**
 * @file models.ts
 * @description Live OpenAI model list. Moved verbatim from `ai.request/shared.ts`.
 *
 * Direct OpenAI models deliberately carry NO price fields: `/v1/models` reports
 * none, and inventing them here would make `buildPriceMap` cost OpenAI requests
 * from fabricated numbers.
 */
import { OpenAI } from "openai";
import type { Model } from "~/features/providers/shared/providers";

export const fetchOpenAIModels = async (apiKey: string): Promise<Model[]> => {
  const client = new OpenAI({ apiKey, timeout: 5000, maxRetries: 0 });
  const page = await client.models.list();
  return page.data.map((model) => ({
    id: model.id,
    name: model.id,
    created: model.created ?? 0,
    provider: "openai",
  }));
};
