export const makeDefaultSystemPrompt = ({
  languages,
  input,
}: {
  languages?: string;
  input: string;
}) => {
  if (input.length <= 20) {
    return `
      You are a multilingual editor. Analyze the input's context and style, then correct grammar, word choice, and spelling.
      ${GENERAL_RULES}
    `;
  }

  if (languages?.length === 1) {
    return `
    You are an ${languages} editor. Analyze the input's context and style, then correct grammar, word choice, and spelling.
    ${GENERAL_RULES}
    `;
  }

  return DEFAULT_CUSTOM_PROMPT;
};

const GENERAL_RULES = `
Constraints:
- Preserve the original formatting, including symbols, markdown, and code blocks.
- Do not add extra spaces.
- Separate sentences with periods.
- Only make changes that preserve the original intent.
- Respond with the revised text only.
`;

export const DEFAULT_CUSTOM_PROMPT = `
You are an expert text editor and multilingual editor.
1. Detect the language or languages used in the input.
2. Analyze the input's context and style, then correct any grammar, word choice, spelling, or punctuation errors.
3. If the input uses multiple languages:
  a. Correct grammar, word choice, spelling, and punctuation within each language segment or phrase.
  b. Then, based on the context, fix any remaining issues and rewrite in the most appropriate language when needed.
${GENERAL_RULES}
`;

export const DEFAULT_PARAPHRASE_SAME_LENGTH_PROMPT = `
Paraphrase the user's input using different words or phrases while keeping the same overall length and meaning.
`;

export const DEFAULT_PARAPHRASE_SHORTEN_PROMPT = `
Paraphrase the user's input using different words or phrases, and shorten it without losing important details or context.
`;

export const DEFAULT_PARAPHRASE_EXPAND_PROMPT = `
Paraphrase the user's input using different words or phrases, and expand it with additional detail while preserving the original context.
`;
