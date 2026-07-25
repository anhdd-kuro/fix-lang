import { DEFAULT_PROMPT_GEN_PROMPT } from "~/prompts";
import { getProfileSetting } from "~/stores/apiStore";
import { estimateTextTokens } from "~/stores/historyStore";
import { StringPrettifier } from "~/utils";
import { makeAIRequest } from "./shared";
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
  context?: string;
  model?: string;
  temperature?: number;
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
      systemPrompt: new StringPrettifier(baseSystemPrompt)
        .removeExtraSpaces()
        .removeExtraSpaces().value,
      userPrompt: `Input:\n${text}`,
      ...options,
      ...currentSettings,
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
