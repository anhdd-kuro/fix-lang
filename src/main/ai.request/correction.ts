import { DEFAULT_CUSTOM_PROMPT } from "~/prompts";
import { makeAIRequest } from "./shared";
import { store } from "../../stores/apiStore";

/**
 * Fixes grammar and style for the given text using OpenAI API.
 * @param text The text to fix.
 * @returns A promise that resolves with the fixed text and token information.
 */
export const fixGrammar = async (
  text: string
): Promise<{
  correctedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  if (!text || !text.trim()) {
    console.log("fixGrammar called with empty or whitespace-only text.");
    return { correctedText: text, promptTokens: null, completionTokens: null };
  }

  // Get correct settings
  const correctSettings = store.get("settingsCorrect");
  const paraphrasePrompt = correctSettings.paraphrasePrompt;
  const userCustomInput = correctSettings.userInput;

  // Determine base system prompt
  let baseSystemPrompt = DEFAULT_CUSTOM_PROMPT;
  if (userCustomInput) {
    baseSystemPrompt = userCustomInput;
  }

  // Add paraphrase prompt if available
  if (paraphrasePrompt) {
    baseSystemPrompt = `${baseSystemPrompt}\n${paraphrasePrompt}`;
  }

  // User prompt for correction
  const userPrompt = `Correct the following input:\n${text}`.trim();

  try {
    // Use shared makeAIRequest function
    const response = await makeAIRequest({
      systemPrompt: baseSystemPrompt,
      userPrompt,
    });

    return {
      correctedText: response.content,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  } catch (error) {
    console.error("Error in fixGrammar:", error);
    throw error;
  }
};
