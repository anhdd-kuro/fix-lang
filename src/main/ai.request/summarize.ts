import { DEFAULT_SUMMARIZE_PROMPT } from "~/prompts";
import { makeAIRequest } from "./shared";
import { store } from "../../stores/apiStore";

/**
 * Summarizes the given text using OpenAI API.
 * @param text The text to summarize.
 * @param options Optional configuration options.
 * @returns A promise with the summarized text and token information.
 */
export const summarizeText = async (
  text: string,
  options?: {
    maxLength?: number;
  }
): Promise<{
  summarizedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  const currentSettings = store.get("settingsSummarize");

  if (!text || !text.trim()) {
    return { summarizedText: text, promptTokens: null, completionTokens: null };
  }

  // Get feature-specific model if set
  const summarizeSettings = store.get("settingsSummarize");
  const featureModel = summarizeSettings.model;

  try {
    // Use shared makeAIRequest function
    const response = await makeAIRequest({
      systemPrompt: DEFAULT_SUMMARIZE_PROMPT,
      userPrompt: text, // For summaries, the entire text is the user prompt
      maxTokens: options?.maxLength || currentSettings.maxLength,
      model: featureModel, // Use feature-specific model if set
    });

    console.log(`Summarize used model: ${featureModel || "default"}`);

    return {
      summarizedText: response.content.join("\n\n"),
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  } catch (error) {
    console.error("Error in summarizeText:", error);
    throw error;
  }
};
