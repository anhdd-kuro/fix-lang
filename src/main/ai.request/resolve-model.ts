/**
 * @file resolve-model.ts
 * @description Pure helper to extract the concrete model an OpenRouter request
 * actually resolved to. Provider responses report the served model in the body
 * `model` field — for floating aliases (e.g. "~openai/gpt-mini-latest") this is
 * the underlying pinned id (e.g. "openai/gpt-5.4-mini-20260317"), which differs
 * from the requested id. No electron dependency — primary test seam.
 */

/**
 * Extract the resolved model id from a raw provider response body.
 * @param resBody The raw response body (OpenRouter / OpenAI shape, untrusted).
 * @param fallback The requested model id to return when the body omits `model`.
 * @returns The served model id, or the fallback when unavailable.
 */
export const extractResolvedModel = (
  resBody: unknown,
  fallback: string,
): string => {
  if (resBody && typeof resBody === "object" && "model" in resBody) {
    const served = (resBody as Record<string, unknown>).model;
    if (typeof served === "string" && served.trim()) {
      return served;
    }
  }
  return fallback;
};
