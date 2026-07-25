import type { Model as OpenAIModel } from "openai/resources.mjs";
import type { Model } from "~/shared/providers";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * Default OpenAI model id. No longer a runtime default (see
 * `resolveDefaultModel` below) — it survives only as the migration target
 * `profileMigration.ts` prefixes a bare legacy model id against, and as the
 * final fallback inside the legacy `resolveDefaultOpenAIModel` delegate.
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
 * Resolve the default model dynamically from a fetched (provider-agnostic)
 * model list: the newest whose id contains both "gpt" and "mini" (e.g. the
 * latest GPT mini), falling back to the first available model, and to
 * `null` — not a guessed id — when the list is empty. Callers turn the
 * result into a composite ref via `modelRefForModel` (see
 * `getDefaultModelId` in `apiStore.ts`); this function has no opinion about
 * provider prefixing.
 */
export const resolveDefaultModel = (models: readonly Model[]): Model | null => {
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
 * Legacy string-id delegate kept for callers that still want a bare id
 * rather than a `Model` (e.g. the General tab's staged fetch). Thin wrapper
 * over `resolveDefaultModel`; falls back to `DEFAULT_OPENAI_MODEL` only when
 * the list is empty, matching the pre-refactor behavior byte-for-byte.
 */
export const resolveDefaultOpenAIModel = (models: ModelLike[]): string =>
  resolveDefaultModel(models as Model[])?.id ?? DEFAULT_OPENAI_MODEL;

export const DEFAULT_LANGUAGE = "English" as const;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  promptGen: "Control+Shift+G", // generate a new prompt based on current selection
  profileSwitch: "Control+Shift+P", // switch to next profile in rotation
};
