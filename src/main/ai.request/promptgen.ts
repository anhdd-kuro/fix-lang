import { OpenAI } from "openai";
import { DEFAULT_PROMPT_GEN_PROMPT, makePromptGenPrompt } from "~/prompts";

/**
 * Settings for prompt generation
 */
export type PromptGenSettings = {
  apiKey: string;
  text: string;
  minLength: number;
  maxLength: number;
  batchCount: number;
  nsfw: boolean;
  context?: string;
  model: string;
  temperature: number;
};

/**
 * Generates a specialized prompt based on input text and settings.
 */
export const generatePrompt = async (
  settings: PromptGenSettings
): Promise<{
  prompts: string[];
  promptTokens: number | null;
  completionTokens: number | null;
}> => {
  const {
    apiKey,
    text,
    minLength,
    maxLength,
    nsfw,
    batchCount,
    model,
    temperature,
  } = settings;

  if (!apiKey) throw new Error("OpenAI API key is missing.");
  if (!text || !text.trim()) {
    return { prompts: [], promptTokens: null, completionTokens: null };
  }

  const openai = new OpenAI({ apiKey });

  // Prepare system prompt with constraints
  let systemPrompt;

  // If user provides custom context, use that instead of default
  if (settings.context && settings.context.trim()) {
    // Use custom user-provided context
    systemPrompt = `${settings.context.trim()}

    Constraints:
    - Generate prompts between ${minLength} and ${maxLength} words in length.`;
  } else {
    // Use default context
    systemPrompt = `
    ${DEFAULT_PROMPT_GEN_PROMPT}

    Constraints:
    - Generate prompts between ${minLength} and ${maxLength} words in length.
    `;
  }

  // Add NSFW constraint if disabled
  if (!nsfw) {
    systemPrompt = `${systemPrompt}
    - Do not generate NSFW, inappropriate, or adult content.`;
  }

  const userPrompt = makePromptGenPrompt(text);
  const res = await openai.chat.completions.create({
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: temperature,
    n: batchCount,
  });
  const prompts = res.choices
    .slice(0, batchCount)
    .map((choice) => choice.message?.content?.trim())
    .filter((content): content is string => content !== undefined);

  const promptTokens = res.usage?.prompt_tokens ?? null;
  const completionTokens = res.usage?.completion_tokens ?? null;

  if (!prompts.length) {
    throw new Error("Failed to generate prompts from OpenAI response.");
  }

  return { prompts, promptTokens, completionTokens };
};
