import { OpenAI } from "openai";
import { DEFAULT_CUSTOM_PROMPT } from "~/prompts";
import { applyGlobalSettings } from "~/prompts/utils";
import { store } from "../../stores/apiStore";

/**
 * Fixes grammar and style for the given text using OpenAI API.
 * @param apiKey The OpenAI API key to use for this request.
 * @param text The text to fix.
 * @param systemPrompt Optional custom system prompt for the OpenAI API.
 * @returns A promise that resolves with the fixed text.
 */
export const fixGrammar = async (
  apiKey: string,
  text: string
): Promise<{
  correctedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  // Check if API key is provided
  if (!apiKey) {
    console.error("fixGrammar called without an API key.");
    throw new Error("OpenAI API key is missing.");
  }

  if (!text || !text.trim()) {
    console.log("fixGrammar called with empty or whitespace-only text.");
    return { correctedText: text, promptTokens: null, completionTokens: null }; // Return original text if it's empty or whitespace
  }

  // Initialize OpenAI client *locally* with the provided key
  const openai = new OpenAI({ apiKey });

  // Get correct settings
  const correctSettings = store.get("settingsCorrect");
  // Extract only what we need
  const paraphrasePrompt = correctSettings.paraphrasePrompt;
  const userCustomInput = correctSettings.userInput;
  // Retrieve randomization level (temperature)
  const temperature = store.get("temperature") as number;

  // Determine base system prompt
  let baseSystemPrompt = DEFAULT_CUSTOM_PROMPT;
  if (userCustomInput) {
    baseSystemPrompt = userCustomInput;
  }

  // Add paraphrase prompt if available
  if (paraphrasePrompt) {
    baseSystemPrompt = `${baseSystemPrompt}\n${paraphrasePrompt}`;
  }

  // Apply global settings to the base system prompt
  const systemPrompt = applyGlobalSettings(baseSystemPrompt);

  // Construct the user prompt - asking to fix the provided text
  const userPrompt = `Fix the following input:\n${text}`.trim();

  try {
    console.log(
      `Sending request to OpenAI with system prompt: \n "${systemPrompt}" \n`,
      `User Prompt: \n "${userPrompt}" \n`
    );
    const selectedModel = store.get("selectedModel");
    if (!selectedModel) {
      throw new Error("You have to select a model first.");
    }
    const res = await openai.chat.completions.create({
      model: selectedModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: userPrompt },
      ],
      temperature, // Randomization level from settings
      max_completion_tokens: 10000, // Adjust as needed based on expected text length
      n: 1, // We only need one correction
      stop: null, // Let the model decide when to stop
    });

    // Log the full response for debugging if necessary
    console.log("OpenAI Full Response:", JSON.stringify(res, null, 2));

    // Extract the corrected text
    const correctedText = res.choices[0]?.message?.content?.trim();
    const promptTokens = res.usage?.prompt_tokens ?? null;
    const completionTokens = res.usage?.completion_tokens ?? null;

    if (!correctedText) {
      console.error("OpenAI response did not contain corrected text.", res);
      throw new Error("Failed to get corrected text from OpenAI response.");
    }

    console.log("Received corrected text from OpenAI.");
    // Note: History management is now handled in the IPC handler

    return { correctedText, promptTokens, completionTokens };
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    // Re-throw the error so the caller (hotkey handler) can potentially notify the user
    throw error;
  }
};
