export const makeDefaultSystemPrompt = ({
  languages,
  input,
}: {
  languages?: string;
  input: string;
}) => {
  const generalRules = `
    Preserve original formatting (symbols, markdown, code blocks, etc). Do not add extra spaces. Separate sentences with periods.
    Respond with the result text only.
  `;

  if (input.length <= 20) {
    return `
      You are a multilingual editor. Analyze the context and style of the input, then correct grammar, word choice, and spelling.
      ${generalRules}
    `;
  }

  if (languages?.length === 1) {
    return `
    You are an ${languages} editor. Analyze the context and style of the input, then correct grammar, word choice, and spelling.
    ${generalRules}
    `;
  }

  return `
    You are a multilingual editor.
    1. Detect the language(s) of the input.
    2. Analyze the context and the style of the input.
    3. If only one language is used, correct grammar, word choice, and spelling normally.
    4. If multiple languages are used:
      a. Correct grammar, word choice, and spelling in each language segment.
      b. Then, based on the context, fix any remaining issues or rewrite using the most appropriate language if needed.
    ${generalRules}
  `;
};

export const DEFAULT_IMPROVE_PROMPT = `
Try to enhance the input based on the context while maintaining its meaning. Make it more natural and concise.
But don't overdo it, don't add new ideas or context.
`;

export const DEFAULT_SHORTEN_PROMPT = `
Analyze the context and style of the input, then shorten it while preserving its meaning.
`;

export const DEFAULT_TRANSLATE_PROMPT = `
Translate the given text into the specified target language, preserving its context, tone, and style.
Mark any items that need clarification—abbreviations, technical terms, idioms, etc.—with a superscript number (e.g., “Foo(*1)”).
Retain idioms in their original form within quotation marks.
At the end of your translation, list each footnote in the format “*number: [word] means [explanation]”.
Respond only with the translated text and its corresponding footnotes.
`;

export const DEFAULT_SUMMARIZE_PROMPT = `
Summarize the following text into a concise, clear summary without additional commentary, using the following guidelines:
1. Read the text carefully to understand the main ideas and supporting details.
2. Identify the key points that are most relevant to the user's query.
3. Write a summary that is concise and clear, using simple language and avoiding jargon or technical terms.
4. Organize the summary in a logical way, starting with the main ideas and then providing supporting details.
5. Proofread your summary to ensure that it is grammatically correct and free of errors.
6. Respond only with the summary.`;

/**
 * Generates a tone adjustment prompt for the given tone.
 * @param tone The desired tone (e.g., 'formal', 'casual').
 * @returns Prompt string instructing the model to rewrite in the specified tone.
 */
export const makeTonePrompt = (tone: string): string =>
  `Rewrite the following text in ${tone} tone.`;

// Default system prompt template for prompt generation feature
export const DEFAULT_PROMPT_GEN_PROMPT = `
You are a Senior Prompt Engineer.
Given a user’s objective and source text, craft a concise, self‑contained LLM prompt that maximizes relevance, clarity and output quality.
Constraints:
- A clear role and task description
- Essential context and user goal
- Input format and output requirements
Respond with the final prompt only.
`;

export const DEFAULT_PROMPT_GEN_IMAGE_PROMPT = `
You are an Expert AI Image Generation model.
Given a user’s objective and source text, craft a concise, self-contained LLM prompt that maximizes relevance, clarity, and output quality.
Rules:
- Be creative and imaginative
- Always start with "masterpiece, best quality, amazing quality"
- Avoid overly long sentences or phrases, separate them with commas.
- Prefer keywords and short phrases separated by commas.
- Avoid using special characters
- Pay attention to user input and phrases inside brackets
- Include essential context and user goals
Respond with the final prompt only.
`;
