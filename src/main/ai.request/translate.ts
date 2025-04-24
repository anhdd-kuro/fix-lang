import {
  TRANSLATE_WITH_EXPLANATION_PROMPT,
  TRANSLATE_WITHOUT_EXPLANATION_PROMPT,
} from "~/prompts";
import { makeAIRequest } from "./shared";

/**
 * Translates the given text into the target language using OpenAI API.
 * @param text The text to translate.
 * @param targetLang The destination language (e.g., "fr", "Japanese").
 * @param includeExplanation Whether to include explanations for terms that might need clarification.
 * @returns A promise with the translated text and token information.
 */
export const translateText = async (
  text: string,
  targetLang: string,
  includeExplanation = false
): Promise<{
  translatedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  if (!text || !text.trim()) {
    return { translatedText: text, promptTokens: null, completionTokens: null };
  }

  // Construct prompt for translation
  const userPrompt = `Translate the following text to ${targetLang}:\n${text}`;

  try {
    // Use shared makeAIRequest function with fixed temperature for translations
    const response = await makeAIRequest({
      systemPrompt: includeExplanation
        ? TRANSLATE_WITH_EXPLANATION_PROMPT
        : TRANSLATE_WITHOUT_EXPLANATION_PROMPT,
      userPrompt,
      temperature: 0, // Translations should be deterministic
    });

    return {
      translatedText: response.content.join("\n\n"),
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  } catch (error) {
    console.error("Error in translateText:", error);
    throw error;
  }
};
