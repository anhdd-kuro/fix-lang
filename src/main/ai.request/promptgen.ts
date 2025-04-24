import { DEFAULT_PROMPT_GEN_PROMPT } from "~/prompts";
import { makeAIRequest } from "./shared";

/**
 * Settings for prompt generation
 */
export type PromptGenSettings = {
  text: string;
  minLength: number;
  maxLength: number;
  batchCount: number;
  nsfw: boolean;
  context?: string;
  model: string;
  temperature: number;
};

/**
 * Generates a specialized prompt based on input text and settings.
 */
export const generatePrompt = async (
  settings: PromptGenSettings
): Promise<{
  prompts: string[];
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  const { text, minLength, maxLength, nsfw, batchCount, model, temperature } =
    settings;

  if (!text || !text.trim()) {
    return { prompts: [], promptTokens: null, completionTokens: null };
  }

  // Prepare base system prompt with constraints
  const baseSystemPrompt = `
    ${settings.context ? settings.context.trim() : DEFAULT_PROMPT_GEN_PROMPT}

    Constraints:
    - Generate prompts randomly between ${minLength} and ${maxLength} words in length.
    ${nsfw ? "" : "- Do not generate NSFW, inappropriate, or adult content."}
  `;

  try {
    // Use shared makeAIRequest function
    const response = await makeAIRequest({
      systemPrompt: baseSystemPrompt,
      userPrompt: `Input:\n${text}`,
      model,
      temperature,
      n: batchCount,
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
