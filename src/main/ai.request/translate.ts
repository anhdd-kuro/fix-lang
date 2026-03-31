import { DEFAULT_OPENAI_MODEL } from "~/const";
import {
  TRANSLATE_WITH_EXPLANATION_PROMPT,
  TRANSLATE_WITHOUT_EXPLANATION_PROMPT,
} from "~/prompts";
import { getProfileSetting } from "~/stores/apiStore";
import { StringPrettifier } from "~/utils";
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
  targetLang?: string,
  includeExplanation = false,
): Promise<{
  translatedText: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}> => {
  if (!text || !text.trim()) {
    return {
      translatedText: text,
      promptTokens: 0,
      completionTokens: 0,
      model: DEFAULT_OPENAI_MODEL,
    };
  }

  // Get feature-specific model from current profile
  const translateSettings = getProfileSetting("settingsTranslate");
  const featureModel = translateSettings.model;

  // Construct prompt for translation
  const userPrompt = `Translate the following text to ${targetLang || translateSettings.destinationLang}:\n${text}`;
  const systemPrompt = new StringPrettifier(`
   ${
     includeExplanation
       ? TRANSLATE_WITH_EXPLANATION_PROMPT
       : TRANSLATE_WITHOUT_EXPLANATION_PROMPT
   }
   Ignore user input language.
  `)
    .removeEmptyLines()
    .removeExtraSpaces().value;

  try {
    // Use shared makeAIRequest function with fixed temperature for translations
    const response = await makeAIRequest({
      systemPrompt,
      userPrompt,
      model: featureModel, // Use feature-specific model if set
    });

    console.log(`Translation used model: ${featureModel || "default"}`);

    return {
      translatedText: response.content.join("\n\n"),
      promptTokens: response.promptTokens ?? 0,
      completionTokens: response.completionTokens ?? 0,
      model: response.model,
    };
  } catch (error) {
    console.error("Error in translateText:", error);
    throw error;
  }
};
