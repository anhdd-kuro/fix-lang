import { OpenAI } from "openai";
import { DEFAULT_SUMMARIZE_PROMPT } from "~/prompts";
import { store } from "../../stores/apiStore";

/**
 * Summarizes the given text using OpenAI API.
 * @param apiKey The OpenAI API key.
 * @param text The text to summarize.
 * @param maxInput The maximum number of tokens to use for the summary.
 */
export const summarizeText = async (
  apiKey: string,
  text: string,
  maxInput: number
): Promise<{
  summarizedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  if (!apiKey) throw new Error("OpenAI API key is missing.");
  if (!text || !text.trim())
    return { summarizedText: text, promptTokens: null, completionTokens: null };
  const openai = new OpenAI({ apiKey });
  const res = await openai.chat.completions.create({
    model: store.get("selectedModel"),
    messages: [
      { role: "system", content: DEFAULT_SUMMARIZE_PROMPT },
      { role: "user", content: text },
    ],
    temperature: store.get("temperature") as number,
    max_tokens: maxInput,
  });
  const summary = res.choices[0]?.message?.content?.trim();
  const promptTokens = res.usage?.prompt_tokens ?? null;
  const completionTokens = res.usage?.completion_tokens ?? null;
  if (!summary) throw new Error("Failed to get summary from OpenAI response.");
  return { summarizedText: summary, promptTokens, completionTokens };
};
