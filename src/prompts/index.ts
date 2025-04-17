export const makeDefaultSystemPrompt = ({
  languages,
  input,
}: {
  languages?: string;
  input: string;
}) => {
  const generalRules = `
    Preserve original formatting (symbols, markdown, code blocks, etc). Do not add extra spaces.
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

/**
 * Generates a tone adjustment prompt for the given tone.
 * @param tone The desired tone (e.g., 'formal', 'casual').
 * @returns Prompt string instructing the model to rewrite in the specified tone.
 */
export const makeTonePrompt = (tone: string): string =>
  `Rewrite the following text in ${tone} tone.`;
