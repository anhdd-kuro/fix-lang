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
  translate: "Control+Shift+T",
  paraphrase: "Control+Shift+P", // restate in different words
  // new ones:
  summarize: "Control+Shift+S", // condense selected text into a brief summary
  explain: "Control+Shift+E", // give a clearer, step‑by‑step explanation
  promptGen: "Control+Shift+G", // generate a new prompt based on current selection
};
