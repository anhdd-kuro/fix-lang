/**
 * @file resolve-model.ts
 * @description Pure helper to extract the concrete model an OpenRouter request
 * actually resolved to. Provider responses report the served model in the body
 * `model` field — for floating aliases (e.g. "~openai/gpt-mini-latest") this is
 * the underlying pinned id (e.g. "openai/gpt-5.4-mini-20260317"), which differs
 * from the requested id. No electron dependency — primary test seam.
 */
import { z } from "zod";
import { objectLike } from "~/features/core/shared/schemaGuard";

/** A body naming the model that served it. */
const ServedModelBodySchema = objectLike({ model: z.string() });

/**
 * Extract the resolved model id from a raw provider response body.
 * @param resBody The raw response body (OpenRouter / OpenAI shape, untrusted).
 * @param fallback The requested model id to return when the body omits `model`.
 * @returns The served model id, or the fallback when unavailable.
 */
export const extractResolvedModel = <Input>(
  resBody: Input,
  fallback: string,
): string => {
  const body = ServedModelBodySchema.safeParse(resBody);
  return body.success && body.data.model.trim() ? body.data.model : fallback;
};
