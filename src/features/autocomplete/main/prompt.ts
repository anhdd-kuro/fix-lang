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
 * WHY THE WORD RULE COMES FIRST, and why it carries an example.
 *
 * `Continue from exactly where the input stops, mid-word if it stops mid-word.`
 * described the caret's position without saying what to DO at it, so a model was
 * free to read a half-typed word as a finished thought and comment on it.
 * `ornith-1.0-9b` did exactly that: `tes` came back as ` is a common
 * abbreviation for test.` — grammatical, a valid continuation of the TEXT, and
 * useless as a completion of the WORD. So the two cases are now stated as an
 * ordered pair, mid-word first: finish the word, else continue the phrase.
 *
 * The example is not decoration. "Never repeat the input" already implies the
 * answer for `tes` is `t`, but completing a word is precisely the moment a model
 * re-emits the whole of it (`test`), because that is the token it is thinking
 * of. `"tes" -> {"suggestion":"t"}, not "test".` closes the gap by showing the
 * appended fragment rather than restating the rule — a suggestion is always what
 * lands AT the caret, never the word that contains it.
 *
 * WHAT AN ALREADY-COMPLETE WORD GETS, and why it is the phrase and not `-ing`.
 * `test` could be finished or could be `testing`; nothing in the buffer says
 * which. The two mistakes are not symmetric. Continuing the phrase appends past
 * a boundary the user has already crossed, so a wrong ghost is discarded by
 * typing on; lengthening a word the user had finished edits INSIDE their word,
 * and a Tab meant for the sentence silently rewrites it. A whole word therefore
 * counts as done, alongside a trailing space or mark.
 *
 * HOW WELL THAT BRANCH ACTUALLY HOLDS, measured rather than assumed. It does
 * not hold absolutely: across 30 runs of `test` against `ornith-1.0-9b`, 9 came
 * back `ing`. Say it plainly, because the next person reading this will test it
 * once and conclude the rule is broken — it is a REQUEST, like the length rule
 * beside it, and the ambiguous case is the one place a weak model still guesses.
 * The residual error is the benign one (a ghost the user ignores), and no
 * wording tried removed it: rules phrased at the LETTER level (`add words, never
 * letters`) traded it for damage to the branch that matters, answering `test`
 * for `tes` — re-emitting the word the mid-word rule exists to fragment. So the
 * fall-back names what to ADD rather than what not to spell.
 *
 * Short on purpose — it is sent on every dispatch and is the cacheable prefix.
 */
export const AUTOCOMPLETE_SYSTEM_PROMPT = `Reply with one JSON object only:
{"suggestion":"<text appended at the caret>"}

- "suggestion" holds only the continuation, never any of the input text.
- Ends mid-word: finish that word. "tes" -> {"suggestion":"t"}, not "test".
- Ends on a whole word, space or mark: add what comes next.
- Match input language, tone and register.
- Stop after one sentence; never emit more than 15 words.
- No markdown, no code fences, no commentary, inside or out.
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
