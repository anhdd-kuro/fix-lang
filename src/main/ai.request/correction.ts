import { Notification } from "electron";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { DEFAULT_CUSTOM_PROMPT } from "~/prompts";
import { getProfileSetting } from "~/stores/apiStore";
import { makeAIRequest } from "./shared";

/**
 * Fixes grammar and style for the given text using OpenAI API.
 * @param text The text to fix.
 * @returns A promise that resolves with the fixed text and token information.
 */
export const fixGrammar = async (
  text: string,
): Promise<{
  correctedText: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}> => {
  if (!text || !text.trim()) {
    console.log("fixGrammar called with empty or whitespace-only text.");
    new Notification({
      title: "Empty Input",
      body: "fixGrammar called with empty or whitespace-only text.",
    }).show();
    return {
      correctedText: text,
      promptTokens: 0,
      completionTokens: 0,
      model: DEFAULT_OPENAI_MODEL,
    };
  }

  // Get correct settings and feature-specific model from the current profile
  const correctSettings = getProfileSetting("settingsCorrect");
  const featureModel = correctSettings.model;
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
      model: featureModel, // Use feature-specific model if set (will fall back to default if empty)
    });

    console.log(`Correction used model: ${featureModel || "default"}`);
    return {
      correctedText: response.content.join("\n\n"),
      promptTokens: response.promptTokens ?? 0,
      completionTokens: response.completionTokens ?? 0,
      model: response.model,
    };
  } catch (error) {
    console.error("Error in fixGrammar:", error);
    throw error;
  }
};
