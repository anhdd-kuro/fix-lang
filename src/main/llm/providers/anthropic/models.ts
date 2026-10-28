/**
 * @file anthropic/models.ts
 * @description Live Anthropic model list from `GET /v1/models`.
 *
 * Deliberately NOT `@anthropic-ai/sdk`: that package resolves `undici` through
 * a runtime `createRequire` for its download path, which Vite cannot inline and
 * `app.asar` (which ships no `node_modules`) cannot resolve — a `MODULE_NOT_FOUND`
 * that only appears in a packaged build. `keepAliveFetch` is the same transport
 * the prewarm path already points at this endpoint, so the socket is shared.
 *
 * Like direct OpenAI discovery, these entries carry NO price fields: `/v1/models`
 * reports none, and inventing them here would make `buildPriceMap` price
 * Anthropic requests from fabricated numbers. `cost.ts` short-circuits the
 * provider to N/A for the same reason.
 */
import { z } from "zod";
import { jsonField, type JsonValue } from "~/main/jsonValue";
import { keepAliveFetch } from "~/main/llm/httpKeepAlive";
import type { Model } from "~/features/providers/shared/providers";

const MODELS_URL = "https://api.anthropic.com/v1/models";

/** Pinned by Anthropic's API contract — an unversioned request is rejected. */
const API_VERSION = "2023-06-01";

/**
 * One page covers the whole catalogue today (Anthropic serves well under a
 * hundred models), and a bounded request keeps a provider-side pagination
 * change from turning model discovery into an unbounded fetch loop.
 */
const PAGE_LIMIT = 1000;

/** Matches the OpenAI client's ceiling: provider setup blocks on this call. */
const TIMEOUT_MS = 5000;

const ModelIdSchema = z.string().min(1);
const DisplayNameSchema = z.string().min(1);
const CreatedAtSchema = z.string();

/** Anthropic stamps `created_at` as ISO 8601; every other provider reports epoch seconds. */
const toEpochSeconds = (createdAt: JsonValue | undefined): number => {
  const stamp = CreatedAtSchema.safeParse(createdAt);
  const parsed = stamp.success ? Date.parse(stamp.data) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
};

export const fetchAnthropicModels = async (
  apiKey: string,
): Promise<Model[]> => {
  const response = await keepAliveFetch(
    `${MODELS_URL}?limit=${String(PAGE_LIMIT)}`,
    {
      method: "GET",
      headers: {
        "x-api-key": apiKey.trim(),
        "anthropic-version": API_VERSION,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    // The body carries Anthropic's own reason (invalid key, permission); the
    // caller redacts it before logging — see `logModelFetch`.
    throw new Error(
      `Anthropic model list failed (${String(response.status)}): ${await response.text()}`,
    );
  }

  const body: JsonValue = await response.json();
  const data = jsonField(body, "data");
  const entries = Array.isArray(data) ? data : [];
  // Every id is checked before any row is built, so a `null` entry anywhere
  // fails the whole list exactly as a property read on it always has.
  const ids = entries.map((entry) =>
    ModelIdSchema.safeParse(jsonField(entry, "id")),
  );
  return entries.flatMap((entry, index) => {
    const id = ids[index];
    if (!id.success) return [];
    // The raw id is what the model picker searches on; `display_name` is only
    // a friendlier label, and an absent one must not blank the row.
    const displayName = DisplayNameSchema.safeParse(
      jsonField(entry, "display_name"),
    );
    return [
      {
        id: id.data,
        name: displayName.success ? displayName.data : id.data,
        created: toEpochSeconds(jsonField(entry, "created_at")),
        provider: "anthropic" as const,
      },
    ];
  });
};
