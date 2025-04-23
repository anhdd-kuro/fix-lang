export const makeDefaultSystemPrompt = ({
  languages,
  input,
}: {
  languages?: string;
  input: string;
}) => {
  if (input.length <= 20) {
    return `
      You are a multilingual editor. Analyze the context and style of the input, then correct grammar, word choice, and spelling.
      ${GENERAL_RULES}
    `;
  }

  if (languages?.length === 1) {
    return `
    You are an ${languages} editor. Analyze the context and style of the input, then correct grammar, word choice, and spelling.
    ${GENERAL_RULES}
    `;
  }

  return DEFAULT_CUSTOM_PROMPT;
};

const GENERAL_RULES = `
Constraints:
- Preserve original formatting (symbols, markdown, code blocks, etc). Do not add extra spaces. Separate sentences with periods.
- Only make changes that respect the original intent.
- Respond with the result text only.
`;

export const DEFAULT_CUSTOM_PROMPT = `
You are an expert text editor and a multilingual editor.
1. Detect the language(s) of the input.
2. Analyze the context and the style of the input. Correct any grammar, word choice, spelling, or punctuation errors
3. If multiple languages are used:
  a. Correct any grammar, word choice, spelling, or punctuation errors in each language segment or phrases.
  b. Then, based on the context, fix any remaining issues then rewrite using the most appropriate language if needed.
${GENERAL_RULES}
`;

export const DEFAULT_PARAPHRASE_SAME_LENGTH_PROMPT = `
Paraphrase the user’s input using different words or phrases while try to keeping the same length and context.
`;

export const DEFAULT_PARAPHRASE_SHORTEN_PROMPT = `
Paraphrase the user’s input using different words or phrases and shorten it without losing the important details and context.
`;

export const DEFAULT_PARAPHRASE_EXPAND_PROMPT = `
Paraphrase the user’s input using different words or phrases and expand upon it with additional detail while maintaining the original context.
`;
