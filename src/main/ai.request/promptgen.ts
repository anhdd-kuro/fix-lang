import { DEFAULT_PROMPT_GEN_PROMPT } from "~/prompts";
import { store } from "~/stores/apiStore";
import { makeAIRequest } from "./shared";

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
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  const currentSettings = store.get("settingsPromptGen");
  const minLength = options.minLength || currentSettings.minLength || 0;
  const maxLength = options.maxLength || currentSettings.maxLength || 0;
  const nsfw = options.nsfw || currentSettings.nsfw || false;
  const text = options.text;

  // Prepare base system prompt with constraints
  const baseSystemPrompt = `
    ${options.context?.trim() || currentSettings.context.trim() || DEFAULT_PROMPT_GEN_PROMPT.trim()}

    Constraints:
    - Generate prompts randomly between ${minLength} and ${maxLength} words in length.
    ${nsfw ? "" : "- Do not generate NSFW, inappropriate, or adult content."}
  `;

  try {
    // Use shared makeAIRequest function
    const response = await makeAIRequest({
      systemPrompt: baseSystemPrompt,
      userPrompt: `Input:\n${text}`,
      ...options,
      ...currentSettings,
    });

    return {
      prompts: response.content,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  } catch (error) {
    console.error("Error in generatePrompt:", error);
    throw error;
  }
};
