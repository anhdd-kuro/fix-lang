import type { Model } from "openai/resources.mjs";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * Default OpenAI model to use for text fixing.
 *
 * @see https://platform.openai.com/docs/pricing
 * @see https://platform.openai.com/docs/models
 */
export const DEFAULT_OPENAI_MODEL = "openai/gpt-4.1-mini" satisfies Model["id"];

export const DEFAULT_LANGUAGE = "English" as const;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  promptGen: "Control+Shift+G", // generate a new prompt based on current selection
  profileSwitch: "Control+Shift+P", // switch to next profile in rotation
};
