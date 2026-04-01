export * from "./correction";

export const TRANSLATE_WITH_EXPLANATION_PROMPT = `
Translate the input into the specified target language while preserving its meaning, context, tone, and style.
For any item that may need clarification—such as an abbreviation, technical term, or idiom—add a superscript number (for example, "Foo(*1)").
Keep idioms in their original form inside quotation marks.
After the translation, list each footnote using this format: "*number: [word] means [explanation]".
Respond only with the translated text followed by its footnotes.
`;

export const TRANSLATE_WITHOUT_EXPLANATION_PROMPT = `
Translate the input into the specified target language while preserving its meaning, context, tone, and style.
Do not include explanations, footnotes, or clarifications.
Respond only with the translated text.
`;

// Keep for backward compatibility
export const DEFAULT_TRANSLATE_PROMPT = TRANSLATE_WITH_EXPLANATION_PROMPT;

export const DEFAULT_SUMMARIZE_PROMPT = `
Summarize the input into a concise, clear summary without adding commentary.
Guidelines:
1. Identify the main ideas and the most relevant supporting details.
2. Focus on the points that matter most to the user's request.
3. Use clear, simple language and avoid unnecessary jargon.
4. Organize the summary logically, starting with the main ideas and then the supporting details.
5. Ensure the final summary is grammatically correct and easy to read.
6. Respond only with the summary.`;

/**
 * Generates a tone adjustment prompt for the given tone.
 * @param tone The desired tone (e.g., 'formal', 'casual').
 * @returns Prompt string instructing the model to rewrite in the specified tone.
 */
export const makeTonePrompt = (tone: string): string =>
  `Rewrite the input in a ${tone} tone.`;

// Default system prompt template for prompt generation feature
export const DEFAULT_PROMPT_GEN_PROMPT = `
You are a senior prompt engineer.
Given the user's objective and source text, write a concise, self-contained LLM prompt that maximizes relevance, clarity, and output quality.
Requirements:
- Include a clear role and task description.
- Include the essential context and the user's goal.
- Specify the input format and output requirements.
Respond with the final prompt only.
`;

export const DEFAULT_PROMPT_GEN_IMAGE_PROMPT = `
You are an expert at writing prompts for AI image generation.
Given the user's objective and source text, write a concise, self-contained prompt that maximizes relevance, clarity, and output quality.
Rules:
- Be creative and imaginative.
- Always begin with: masterpiece, best quality, amazing quality.
- Keep the prompt concise; use commas to separate ideas instead of long sentences.
- Do not use special characters.
- Pay close attention to user input and to any phrases inside brackets, especially character names.
- Keep character-name keywords in their original form.
- Balance the level of detail between the character and the background.
- Respond with the final prompt only.
`;
