import { OpenAI } from "openai";
import { DEFAULT_TRANSLATE_PROMPT } from "~/prompts";
import { applyGlobalSettings } from "~/prompts/utils";
import { store } from "../../stores/apiStore";

/**
 * Translates the given text into the target language using OpenAI API.
 * @param apiKey The OpenAI API key.
 * @param text The text to translate.
 * @param targetLang The destination language (e.g., "fr", "Japanese").
 */
export const translateText = async (
  apiKey: string,
  text: string,
  targetLang: string
): Promise<{
  translatedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  if (!apiKey) throw new Error("OpenAI API key is missing.");
  if (!text || !text.trim())
    return { translatedText: text, promptTokens: null, completionTokens: null };
  const openai = new OpenAI({ apiKey });
  // Construct prompt for translation
  const userPrompt = `Translate the following text to ${targetLang}:\n${text}`;
  // Apply global settings to the default translate prompt
  const systemPrompt = applyGlobalSettings(DEFAULT_TRANSLATE_PROMPT);

  const res = await openai.chat.completions.create({
    model: store.get("selectedModel"),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  });
  const translated = res.choices[0]?.message?.content?.trim();
  const promptTokens = res.usage?.prompt_tokens ?? null;
  const completionTokens = res.usage?.completion_tokens ?? null;
  if (!translated)
    throw new Error("Failed to get translation from OpenAI response.");
  return { translatedText: translated, promptTokens, completionTokens };
};
