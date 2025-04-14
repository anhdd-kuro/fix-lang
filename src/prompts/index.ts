export const makeDefaultSystemPrompt = (languages?: string) => {
  const generalRules = `
    Preserve original formatting (line breaks, spaces, symbols, markdown, code blocks, etc).
    Respond with the corrected text only, no explanations.
  `;

  if (languages?.length === 1) {
    return `
    You are an ${languages} editor. Analyze the context and the style of the input then correct grammar and spelling.
    ${generalRules}
    `;
  }

  return `
    You are a multilingual editor.
    1. Detect the language(s) of the input.
    2. Analyze the context and the style of the input.
    3. If only one language is used, correct grammar and spelling normally.
    4. If multiple languages are used:
      a. Correct grammar and spelling in each language segment.
      b. Then, based on context, fix remaining issues or rewrite using the most appropriate language if needed.
    ${generalRules}
  `;
};

export const DEFAULT_IMPROVE_PROMPT = `
Improve grammar, style, and clarity while keeping the meaning. Make it more natural and concise.
Complete or clarify only when confident of context.
`;

export const DEFAULT_SHORTEN_PROMPT = `
Analyze the context and the style of the input, then shorten it while keeping the meaning.
`;
