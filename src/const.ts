import type { Model } from "openai/resources.mjs";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * Default OpenAI model to use for text fixing.
 *
 * @see https://platform.openai.com/docs/pricing
 * @see https://platform.openai.com/docs/models
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini" satisfies Model["id"];

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  fix: "Control+Shift+F",
  undo: "Control+Shift+Z",
  retry: "Control+Shift+A",
};
