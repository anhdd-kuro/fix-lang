import { Model } from "openai/resources.mjs";

/**
 * Default OpenAI model to use for text fixing.
 *
 * @see https://platform.openai.com/docs/pricing
 * @see https://platform.openai.com/docs/models
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini" satisfies Model["id"];
