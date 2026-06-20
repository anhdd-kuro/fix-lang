export * from "./correction";

export const TRANSLATE_WITH_EXPLANATION_PROMPT = `
Task: Translate the input into the specified target language.
Requirements:
- Preserve the original meaning, context, tone, and style.
- If any abbreviation, technical term, idiom, or other item may need clarification, mark it with a superscript number, for example: "Foo(*1)".
- Keep idioms in their original form inside quotation marks.
Output:
- Return only the translated text.
- After the translation, list each footnote in this format: "*number: [word] means [explanation]".
`;

export const TRANSLATE_WITHOUT_EXPLANATION_PROMPT = `
Task: Translate the input into the specified target language.
Requirements:
- Preserve the original meaning, context, tone, and style.
- Do not include explanations, footnotes, or clarifications.
Output:
- Return only the translated text.
`;

// Keep for backward compatibility
export const DEFAULT_TRANSLATE_PROMPT = TRANSLATE_WITH_EXPLANATION_PROMPT;

export const DEFAULT_SUMMARIZE_PROMPT = `
Task: Summarize the input.
Requirements:
1. Identify the main ideas and the most relevant supporting details.
2. Focus on the points that matter most to the user's request.
3. Use clear, simple language and avoid unnecessary jargon.
4. Organize the summary logically, starting with the main ideas and then the supporting details.
5. Make sure the final summary is grammatically correct and easy to read.
Output:
- Return only the summary.
`;

// Default system prompt template for prompt generation feature
export const DEFAULT_PROMPT_GEN_PROMPT = `
You are a senior prompt engineer.
Task: Given the user's objective and source text, write a concise, self-contained LLM prompt.
Requirements:
- Make the prompt clear, relevant, and high quality.
- Include a clear role and task description.
- Include the essential context and the user's goal.
- Specify the input format and output requirements.
Output:
- Return only the final prompt.
`;

export const DEFAULT_PROMPT_GEN_IMAGE_PROMPT = `
You are an expert at writing prompts for AI image generation.
Task: Given the user's objective and source text, write a concise, self-contained image prompt.
Requirements:
- Be creative and imaginative.
- Always begin with: masterpiece, best quality, amazing quality.
- Keep the prompt concise and use commas instead of long sentences.
- Do not use special characters.
- Pay close attention to the user input and to any phrases inside brackets, especially character names.
- Keep character-name keywords in their original form.
- Balance the level of detail between the character and the background.
Output:
- Return only the final prompt.
`;
