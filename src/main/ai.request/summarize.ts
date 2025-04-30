import { DEFAULT_OPENAI_MODEL } from "~/const";
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
  promptTokens: number;
  completionTokens: number;
  model: string;
}> => {
  const currentSettings = store.get("settingsSummarize");

  if (!text || !text.trim()) {
    return {
      summarizedText: text,
      promptTokens: 0,
      completionTokens: 0,
      model: DEFAULT_OPENAI_MODEL,
    };
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
      ...response,
    };
  } catch (error) {
    console.error("Error in summarizeText:", error);
    throw error;
  }
};
