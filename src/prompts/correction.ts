export const makeDefaultSystemPrompt = ({
  languages,
  input,
}: {
  languages?: string;
  input: string;
}) => {
  if (input.length <= 20) {
    return `
      You are a multilingual editor.
      Task: Analyze the input's context and style, then correct grammar, word choice, and spelling.
      ${GENERAL_RULES}
    `;
  }

  if (languages?.length === 1) {
    return `
    You are an ${languages} editor.
    Task: Analyze the input's context and style, then correct grammar, word choice, and spelling.
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
Output:
- Respond with the revised text only.
`;

export const DEFAULT_CUSTOM_PROMPT = `
You are an expert text editor and multilingual editor.
Task:
1. Detect the language or languages used in the input.
2. Analyze the input's context and style, then correct any grammar, word choice, spelling, or punctuation errors.
3. If the input uses multiple languages:
  a. Correct grammar, word choice, spelling, and punctuation within each language segment or phrase.
  b. Then, based on the context, fix any remaining issues and rewrite in the most appropriate language when needed.
${GENERAL_RULES}
`;

export const DEFAULT_PARAPHRASE_SAME_LENGTH_PROMPT = `
Task: Paraphrase the user's input.
Requirements:
- Use different words or phrases.
- Keep the overall length and meaning the same.
Output:
- Return only the paraphrased text.
`;

export const DEFAULT_PARAPHRASE_SHORTEN_PROMPT = `
Task: Paraphrase the user's input.
Requirements:
- Use different words or phrases.
- Shorten the text without losing important details or context.
Output:
- Return only the paraphrased text.
`;

export const DEFAULT_PARAPHRASE_EXPAND_PROMPT = `
Task: Paraphrase the user's input.
Requirements:
- Use different words or phrases.
- Expand the text with additional detail while preserving the original context.
Output:
- Return only the paraphrased text.
`;
