import askMarkdown from "./ask.md?raw";
import businessWritingMarkdown from "./business-writing.md?raw";
import cavemanMarkdown from "./caveman.md?raw";
import enhancePromptMarkdown from "./enhance-prompt.md?raw";
import structuredTextMarkdown from "./structured-text.md?raw";
import strategicCompactSkillMarkdown from "./summarize.md?raw";

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

Your task is to revise the user's text with maximum fidelity to meaning, while making it clear, natural, and correct.

Process:
1. Detect the language or languages used in the input.
2. Infer the context, audience, and tone from the text itself.
3. Correct grammar, spelling, punctuation, capitalization, and awkward word choice.
4. Preserve the original meaning, intent, and level of formality unless the text clearly benefits from a small style improvement.
5. If the input contains multiple languages:
   - Correct each language segment within its own language.
   - Keep code-switching only when it appears intentional and useful.
   - If a phrase or sentence is better expressed in a single language for clarity, rewrite it in the most appropriate language based on context.
6. If the text is already correct, make only minimal edits or return it unchanged.

Output rules:
- Return only the corrected text.
- Do not explain your changes.
- Do not add commentary.
- Do not mention the detected language unless it is necessary for the corrected text.
- Preserve line breaks, formatting, lists, and special characters unless a change is needed for correctness or clarity.
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

export const DEFAULT_CORRECTION_PRESET_ID = "correction";
export const DEFAULT_SUMMARIZE_PRESET_ID = "summarize";
export const DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID = "prompt-optimization";
export const DEFAULT_TRANSLATE_PRESET_ID = "translate";
export const DEFAULT_BUSINESS_WRITING_PRESET_ID = "business-writing";
export const DEFAULT_STRUCTURED_TEXT_PRESET_ID = "structured-text";
export const DEFAULT_ASK_PRESET_ID = "ask";
export const DEFAULT_CAVEMAN_PRESET_ID = "caveman";

/**
 * The one built-in combo. Lives beside the preset ids because it is addressed
 * the same way — by a stable id the normalizer matches against, never by name.
 */
export const DEFAULT_PERFECT_PROMPT_COMBO_ID = "perfect-prompt";

export const DEFAULT_TRANSLATE_PRESET_PROMPT = `\
You are a bilingual translation engine specialized in Japanese and English.

Task: Detect whether the input text is primarily Japanese or English, then translate it into the other language.

Instructions:
- If the input is primarily Japanese, output natural English only.
- If the input is primarily English, output natural Japanese only.
- Preserve the original meaning, tone, intent, level of formality, and formatting as closely as possible.
- Keep line breaks, lists, labels, punctuation style, and markdown structure when they matter to the original.
- If the input contains mixed Japanese and English, translate into the language that is clearly dominant.
- Output only the translated text, with no explanation, notes, commentary, labels, or extra text.

.`;

export const DEFAULT_SUMMARIZE_PRESET_PROMPT =
  strategicCompactSkillMarkdown.trim();

export const DEFAULT_PROMPT_OPTIMIZATION_PROMPT = enhancePromptMarkdown.trim();

export const DEFAULT_BUSINESS_WRITING_PRESET_PROMPT =
  businessWritingMarkdown.trim();

export const DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT =
  structuredTextMarkdown.trim();

export const DEFAULT_ASK_PRESET_PROMPT = askMarkdown.trim();

export const DEFAULT_CAVEMAN_PRESET_PROMPT = cavemanMarkdown.trim();

/**
 * Standalone instruction fragments for each Caveman intensity level. A later
 * card composes one of these onto `DEFAULT_CAVEMAN_PRESET_PROMPT` at request
 * time — nothing in this file assembles them together.
 *
 * COMPOSITION ORDER — this is a contract, not a preference. Exactly ONE
 * directive is APPENDED AFTER `DEFAULT_CAVEMAN_PRESET_PROMPT`, as the final
 * line of the system prompt, with the text to compress arriving separately as
 * the user message. The base prompt states that its instructions end with the
 * intensity level line and that everything after that line is input to
 * compress, so prepending a directive would put it on the input side of that
 * boundary. Never place a directive before the base prompt, and never append
 * two of them.
 *
 * The levels are cumulative: `full` keeps doing what `lite` does and cuts
 * further, `ultra` keeps doing what `full` does and cuts further still, so each
 * directive is self-sufficient on its own and only one is ever sent.
 */
export const DEFAULT_CAVEMAN_LITE_DIRECTIVE = `\
Lite level: keep every article and write full grammatical sentences. Drop only filler words, hedging, and pleasantries. Do not swap words for shorter synonyms, and do not shorten any term. Stay professional but tight.`;

export const DEFAULT_CAVEMAN_FULL_DIRECTIVE = `\
Full level: drop articles. Sentence fragments are fine. Use short synonyms in place of long phrases. Keep general technical terms spelled out in full — shortening them belongs to the ultra level. Classic caveman compression.`;

export const DEFAULT_CAVEMAN_ULTRA_DIRECTIVE = `\
Ultra level: drop articles and write fragments, then compress further. Shorten general technical terms, using only the short forms the input's own language conventionally uses — in English, DB, auth, config, req, res, fn, impl. When a term has no established short form in the input's language, leave it as written rather than substituting an English abbreviation, and never shorten an identifier in any language. Strip conjunctions. Use arrows (→) to show cause and effect. Use one word wherever one word says enough.`;
