import type { Model as OpenAIModel } from "openai/resources.mjs";
import type { Model } from "~/features/providers/shared/providers";
import type { KeyBindings } from "~/features/providers/store/apiStore";

/**
 * Default OpenAI model id. No longer a runtime default resolved from a live
 * fetch (see `resolveDefaultModel` below) — `profileMigration.ts` never
 * imports this constant; it prefixes bare legacy model ids with a
 * **provider id** (e.g. `"openai"`), not with this model id. What actually
 * still uses it: the empty-list fallback inside the legacy
 * `resolveDefaultOpenAIModel` delegate, and two UI-facing placeholders —
 * `correction.ts`'s empty-text early return, and `ModelSelect.tsx`'s
 * "couldn't resolve a default" fallback.
 *
 * @see https://platform.openai.com/docs/pricing
 * @see https://platform.openai.com/docs/models
 */
export const DEFAULT_OPENAI_MODEL = "openai/gpt-4.1-mini" satisfies OpenAIModel["id"];

/**
 * Normalize a string for flexible matching: lowercase + strip every
 * non-alphanumeric character (spaces, "-", "/", ".", "?", etc.).
 *
 * e.g. "gpt 5" -> "gpt5", "openai/gpt-5" -> "openaigpt5"
 */
export const normalizeForSearch = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Minimal model shape needed to resolve the dynamic default. */
type ModelLike = { id: string; created?: number };

/**
 * Shared implementation for both exports below: the newest entry whose id
 * contains both "gpt" and "mini" (e.g. the latest GPT mini), falling back to
 * the first available entry, and to `null` — not a guessed id — when the
 * list is empty. Generic over `ModelLike` so `resolveDefaultOpenAIModel` can
 * call it with a bare `{id, created?}` list without a cast to `Model[]`: a
 * cast there would silently assert the `name`/non-optional `created` fields
 * `Model` requires but `ModelLike` doesn't guarantee — nothing here
 * reads either, so there is nothing to assert.
 */
const resolveNewestGptMini = <T extends ModelLike>(models: readonly T[]): T | null => {
  const gptMinis = models.filter((model) => {
    const id = normalizeForSearch(model.id);
    return id.includes("gpt") && id.includes("mini");
  });

  if (gptMinis.length > 0) {
    return gptMinis.reduce((newest, model) =>
      (model.created ?? 0) > (newest.created ?? 0) ? model : newest,
    );
  }

  return models[0] ?? null;
};

/**
 * Resolve the default model dynamically from a fetched (provider-agnostic)
 * model list. Callers turn the result into a composite ref via
 * `modelRefForModel` (see `getDefaultModelId` in `apiStore.ts`); this
 * function has no opinion about provider prefixing.
 */
export const resolveDefaultModel = (models: readonly Model[]): Model | null =>
  resolveNewestGptMini(models);

/**
 * Legacy string-id delegate kept for callers that still want a bare id
 * rather than a `Model` (e.g. the General tab's staged fetch). Thin wrapper
 * over the same resolution logic as `resolveDefaultModel`; falls back to
 * `DEFAULT_OPENAI_MODEL` only when the list is empty, matching the
 * pre-refactor behavior byte-for-byte.
 */
export const resolveDefaultOpenAIModel = (models: ModelLike[]): string =>
  resolveNewestGptMini(models)?.id ?? DEFAULT_OPENAI_MODEL;

export const DEFAULT_LANGUAGE = "English" as const;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  promptGen: "Control+Shift+G", // generate a new prompt based on current selection
  profileSwitch: "Control+Shift+P", // switch to next profile in rotation
};
