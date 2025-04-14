export const makeDefaultSystemPrompt = (languages?: string) =>
  languages
    ? `
    You are an ${languages} editor. Correct grammar and style. Reply with the fixed text only, no explanations.
    Keep the original structure (line breaks, spaces, symbols, including ".md" structure).
    `
    : `You are a multilingual language editor. Detect the language of the input text and correct its grammar and style accordingly. Reply with the fixed text only, no explanations.`;

export const DEFAULT_IMPROVE_PROMPT = `
Analyze the meaning of the following text, then improve it, make it more like native Speaker.
`;

export const DEFAULT_SHORTEN_PROMPT = `
Analyze the meaning of the following text, then shorten it while maintaining its meaning.
`;
