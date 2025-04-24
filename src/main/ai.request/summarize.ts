import { DEFAULT_SUMMARIZE_PROMPT } from "~/prompts";
import { makeAIRequest } from "./shared";

/**
 * Summarizes the given text using OpenAI API.
 * @param text The text to summarize.
 * @param maxInput The maximum number of tokens to use for the summary.
 * @returns A promise with the summarized text and token information.
 */
export const summarizeText = async (
  text: string,
  maxInput: number
): Promise<{
  summarizedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  if (!text || !text.trim()) {
    return { summarizedText: text, promptTokens: null, completionTokens: null };
  }

  try {
    // Use shared makeAIRequest function
    const response = await makeAIRequest({
      systemPrompt: DEFAULT_SUMMARIZE_PROMPT,
      userPrompt: text, // For summaries, the entire text is the user prompt
      maxTokens: maxInput,
    });

    return {
      summarizedText: response.content,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  } catch (error) {
    console.error("Error in summarizeText:", error);
    throw error;
  }
};
