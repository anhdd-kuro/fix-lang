import { DEFAULT_PROMPT_GEN_PROMPT } from "~/prompts";
import { getProfileSetting } from "~/stores/apiStore";
import { estimateTextTokens } from "~/stores/historyStore";
import { StringPrettifier } from "~/utils";
import { makeAIRequest } from "./shared";
import { withActiveAppContext } from "./transform-context";
import type { ProviderId } from "~/stores/apiStore";

/**
 * Settings for prompt generation
 */
export type PromptGenSettings = {
  text: string;
  minLength?: number;
  maxLength?: number;
  batchCount?: number;
  nsfw?: boolean;
  /** User-authored system prompt override — unrelated to `activeAppName`. */
  context?: string;
  model?: string;
  temperature?: number;
  /**
   * Frontmost macOS app when the PromptGen hotkey fired. Best-effort ambient
   * context, appended to the system prompt like the transform path does.
   */
  activeAppName?: string | null;
};

/**
 * Generates a specialized prompt based on input text and settings.
 */
export const generatePrompt = async (
  options: PromptGenSettings
): Promise<{
  prompts: string[];
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: ProviderId;
  resolvedModel: string;
}> => {
  const currentSettings = getProfileSetting("settingsPromptGen");
  const minLength = options.minLength || currentSettings.minLength || 0;
  const maxLength = options.maxLength || currentSettings.maxLength || 0;
  const nsfw = options.nsfw || currentSettings.nsfw || false;
  const text = options.text;

  // Prepare base system prompt with constraints
  const baseSystemPrompt = `
    ${options.context?.trim() || currentSettings.context.trim() || DEFAULT_PROMPT_GEN_PROMPT.trim()}

    Additional instructions:
    - The final response should be around ${minLength} ~ ${maxLength} words in length.
    ${nsfw ? "" : "- Do not generate NSFW, inappropriate, or adult content."}
  `;

  try {
    // Use shared makeAIRequest function
    const response = await makeAIRequest({
      // Appended after prettifying: the context block's own newlines and
      // leading "- " bullets must survive `removeExtraSpaces`, which collapses
      // the indentation of the template literal above.
      systemPrompt: withActiveAppContext(
        new StringPrettifier(baseSystemPrompt)
          .removeExtraSpaces()
          .removeExtraSpaces().value,
        { activeAppName: options.activeAppName },
      ),
      userPrompt: `Input:\n${text}`,
      // Order matters: the profile settings are the DEFAULTS, so they spread
      // first and an explicit `options` value wins. The reverse order (the
      // original) let `settingsPromptGen.model` silently overwrite a model the
      // caller asked for by name — a pre-existing bug, invisible only because
      // the sole in-tree caller (`keybindings/promptGen.ts`) passes just
      // `{ text }`, so the two objects never collided. It surfaces the moment
      // anything requests a specific model.
      ...currentSettings,
      ...options,
    });

    // Extract required values from response
    const { content, promptTokens, completionTokens, model, provider, resolvedModel } =
      response;

    const completionText = content.join("\n\n");

    return {
      prompts: content,
      promptTokens:
        promptTokens && promptTokens > 0 ? promptTokens : estimateTextTokens(text),
      completionTokens:
        completionTokens && completionTokens > 0
          ? completionTokens
          : estimateTextTokens(completionText),
      model,
      provider,
      resolvedModel: resolvedModel ?? model,
    };
  } catch (error) {
    console.error("Error in generatePrompt:", error);
    throw error;
  }
};
