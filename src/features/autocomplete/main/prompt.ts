/**
 * @file prompt.ts
 * @description Builds the autocomplete request's system and user prompts.
 *
 * Pure — no Electron, no store reads — so the windowing rules are unit-testable
 * without a running app.
 */

/** Characters of text before the caret sent as context. */
export const PREFIX_WINDOW_CHARS = 600;
/** Characters of text after the caret sent as context. */
export const SUFFIX_WINDOW_CHARS = 200;

/**
 * Kept here rather than in `src/prompts/` on purpose: that directory holds the
 * preset prompts a user can edit, and its marker-discipline tests
 * (`askPrompt.test.ts`, `defaultPresetPrompts.test.ts`) exist to police exactly
 * those. This one is internal and never surfaced for editing.
 *
 * WHY IT IS A JSON CONTRACT, and why every line below is shaped the way it is.
 *
 * The previous version ended `If a sensible continuation is not obvious, output
 * nothing at all.` — an English sentence, and the LAST thing in the prompt. A
 * model that does not honour the system/user split reads the whole thing as one
 * document and does what it was built to do: continue it. `ornith-1.0-9b` on LM
 * Studio duly returned `nothing at all, as there is no clear context or
 * narrative to continue.` AS THE SUGGESTION, and that prose painted as ghost
 * text one Tab press from the user's own question.
 *
 * So the rule is: NO SENTENCE HERE MAY BE PLAUSIBLY CONTINUABLE AS PROSE. The
 * first line and the last line are both literal JSON objects, which is where a
 * continuation-shaped model's attention lands hardest — the highest-probability
 * next token after this prompt is `{`, not a word. The decline case is no longer
 * an instruction that can be obeyed by writing English; it is a value,
 * `{"suggestion":""}`, and a closed JSON object has no grammatical
 * continuation. The rules in between are imperative fragments, not statements
 * about what the model should conclude.
 *
 * The JSON is also the enforcement point, not just the request: `parseReply.ts`
 * accepts nothing else, so a model that ignores all of this produces no
 * suggestion rather than a paragraph of refusal.
 *
 * WHY THE LENGTH RULE CARRIES A NUMBER. There is no `maxOutputTokens` ceiling on
 * this request any more (see the dispatch site in `service.ts`), so this line is
 * the only thing asking for a short reply. `At most one sentence.` was a
 * category, and a category is judged by the model: one sentence can run eighty
 * words. A word count cannot be reinterpreted, so the rule states one — an
 * imperative with a number in it, not an adjective.
 *
 * Short on purpose — it is sent on every dispatch and is the cacheable prefix.
 */
export const AUTOCOMPLETE_SYSTEM_PROMPT = `Reply with one JSON object and nothing else:
{"suggestion":"<text that continues the input>"}

- "suggestion" holds only the continuation, never any of the input text.
- Continue from exactly where the input stops, mid-word if it stops mid-word.
- Match the language, tone, and register of the input.
- Stop after one sentence; never emit more than 15 words.
- No markdown, no code fences, no commentary, inside or outside the JSON.
- Nothing worth suggesting: {"suggestion":""}`;

export type AutocompletePromptInput = {
  /** Text before the caret. */
  prefix: string;
  /** Text after the caret; empty when the caret is at the end. */
  suffix?: string;
};

/**
 * Windows the surrounding text and frames it for the model.
 *
 * The prefix keeps its TAIL and the suffix keeps its HEAD: the caret is the only
 * position that matters, so truncation has to discard the text furthest from it.
 * Trimming the wrong end would hand the model context it cannot continue from.
 *
 * Whitespace is never trimmed — a trailing space is the difference between
 * continuing a word and starting the next one.
 *
 * The trailing label is `JSON:` rather than the old `Continuation:` for the same
 * reason the system prompt was rewritten: `Continuation:` is a prose cue, and
 * the observed failure was a model answering it with a sentence about why it
 * could not continue. `JSON:` cues a brace.
 */
export const buildAutocompletePrompt = ({
  prefix,
  suffix = "",
}: AutocompletePromptInput): { systemPrompt: string; userPrompt: string } => {
  const windowedPrefix = prefix.slice(-PREFIX_WINDOW_CHARS);
  const windowedSuffix = suffix.slice(0, SUFFIX_WINDOW_CHARS);

  const userPrompt = windowedSuffix
    ? `Text before the caret:\n${windowedPrefix}\n\nText after the caret:\n${windowedSuffix}\n\nJSON:`
    : `Text before the caret:\n${windowedPrefix}\n\nJSON:`;

  return { systemPrompt: AUTOCOMPLETE_SYSTEM_PROMPT, userPrompt };
};
