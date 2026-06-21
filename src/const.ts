import type { Model } from "openai/resources.mjs";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * Default OpenAI model to use for text fixing.
 *
 * @see https://platform.openai.com/docs/pricing
 * @see https://platform.openai.com/docs/models
 */
export const DEFAULT_OPENAI_MODEL = "openai/gpt-4.1-mini" satisfies Model["id"];

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
 * Resolve the default OpenAI model dynamically from the fetched model list.
 *
 * Picks the newest model whose id contains both "gpt" and "mini"
 * (e.g. the latest GPT mini), falling back to the first available model,
 * and finally to {@link DEFAULT_OPENAI_MODEL} when the list is empty.
 */
export const resolveDefaultOpenAIModel = (models: ModelLike[]): string => {
  const gptMinis = models.filter((model) => {
    const id = normalizeForSearch(model.id);
    return id.includes("gpt") && id.includes("mini");
  });

  if (gptMinis.length > 0) {
    const latest = gptMinis.reduce((newest, model) =>
      (model.created ?? 0) > (newest.created ?? 0) ? model : newest,
    );
    return latest.id;
  }

  return models[0]?.id ?? DEFAULT_OPENAI_MODEL;
};

export const DEFAULT_LANGUAGE = "English" as const;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  promptGen: "Control+Shift+G", // generate a new prompt based on current selection
  profileSwitch: "Control+Shift+P", // switch to next profile in rotation
};
