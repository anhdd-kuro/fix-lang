/**
 * @file prompt.ts
 * @description Builds the autocomplete request's system and user prompts.
 *
 * Pure — no Electron, no store reads — so the windowing rules are unit-testable
 * without a running app. Imports are a type plus the shared metadata apply
 * function (`withUserMetadata`), which is itself Electron-free.
 */
import { withUserMetadata } from "~/main/ai.request/user-metadata";
import type { AskContextSource } from "~/features/ask/shared/ask";

/** Characters of text before the caret sent as context. */
export const PREFIX_WINDOW_CHARS = 600;
/** Characters of text after the caret sent as context. */
export const SUFFIX_WINDOW_CHARS = 200;
/**
 * Characters of the ATTACHED Ask context sent with the request.
 *
 * Windowed from the HEAD, which is the opposite end from the prefix beside it —
 * and the reason is that this passage is not caret-relative at all. The prefix
 * keeps its tail because the caret is the only position a continuation can be
 * written from; the attached context is never continued, it only says what the
 * question is ABOUT, and the opening of a passage is what identifies its
 * subject. A tail-windowed context would hand the model the last 400 characters
 * of something whose topic was stated in the first line.
 */
export const CONTEXT_WINDOW_CHARS = 400;
/**
 * Characters of the press's ENVIRONMENT block sent with the request.
 *
 * Small but not unbounded, which is the whole reason it has a constant at all:
 * the block is a handful of `Key: value` lines, but five of those lines are
 * recent PRESET NAMES, and a preset name is user-editable text with no length
 * of its own. `askEnvironment.ts` already caps each name; this caps the block,
 * so a profile full of essay-length preset names cannot quietly become the
 * largest thing on a request that fires while the user types.
 *
 * Windowed from the HEAD like the attached context, and for a sharper version
 * of the same reason: the block's leading lines are the locale, the keyboard
 * and the time — the facts a continuation can actually use — and the recent
 * transforms trailing them are the softest thing in it. Truncation drops the
 * least useful end.
 */
export const ENVIRONMENT_WINDOW_CHARS = 400;

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
 * WHY A CONTEXT RULE EXISTS AT ALL. The user prompt may carry an attached
 * passage — the selection (or clipboard text) the Ask input window is showing in
 * its context card — and a model handed two blocks of text will sometimes
 * continue the WRONG one, answering with a continuation of the passage rather
 * than of the half-typed question. The rule is an imperative fragment like the
 * ones around it and sits in the MIDDLE of the list, never at the end: the last
 * line has to stay `{"suggestion":""}`, because the end of the prompt is where a
 * continuation-shaped model picks up.
 *
 * Short on purpose — it is sent on every dispatch and is the cacheable prefix.
 */
export const AUTOCOMPLETE_SYSTEM_PROMPT = `Reply with one JSON object only:
{"suggestion":"<text appended at the caret>"}

- "suggestion" holds only the continuation, never any of the input text.
- Ends mid-word: finish that word. "tes" -> {"suggestion":"t"}, not "test".
- Ends on a whole word, space or mark: add what comes next.
- Context blocks are background only; continue the text before the caret.
- Match input language, tone and register.
- Stop after one sentence; never emit more than 15 words.
- No markdown, no code fences, no commentary, inside or out.
- Nothing worth suggesting: {"suggestion":""}`;

/**
 * The passage the Ask input window has attached, as the prompt needs to see it.
 *
 * `source` is the SAME `AskContextSource` the input window labels its card with,
 * reused rather than restated: the card says `Selected text` or `From clipboard`
 * to the user, and the prompt says the same thing to the model, so a third
 * vocabulary here would let the two drift. The type is Electron-free, which is
 * what lets this module stay so.
 */
export type AutocompleteAskContext = {
  text: string;
  source: AskContextSource;
};

/**
 * Model-facing English, never an i18n key: this text is read by a provider, not
 * by the user, and translating it would make the prompt — and with it the cache
 * key — depend on the app's display language.
 */
const CONTEXT_SOURCE_LABELS: Record<AskContextSource, string> = {
  selection: "selected text",
  clipboard: "from clipboard",
};

export type AutocompletePromptInput = {
  /** Text before the caret. */
  prefix: string;
  /** Text after the caret; empty when the caret is at the end. */
  suffix?: string;
  /** The attached Ask context, when the window has one. */
  context?: AutocompleteAskContext;
  /**
   * The press's environment directives, exactly as
   * `~/main/keybindings/askEnvironment.ts` rendered them for the Ask request
   * itself — the app locale, the system language, the keyboard input source,
   * the press time and the recent preset names.
   *
   * Passed through as a STRING rather than as the structure behind it, so the
   * ghost text is written against the same bytes the submitted question will
   * carry. A second rendering here would drift from that one silently.
   */
  environment?: string;
};

/**
 * The attached passage as a labelled block, plus how much of it is being sent.
 *
 * LABELLED, and labelled as something the user ATTACHED rather than as more
 * input: without a label a second block of prose above the caret text is just
 * more text to continue, which is the failure the system prompt's context rule
 * and this heading defend against together. Naming the source in the heading
 * also carries the one fact the model cannot infer — clipboard text may be
 * minutes old and about something else entirely.
 *
 * The length is returned rather than recomputed by the caller so the windowing
 * rule lives in exactly one place; it is what the dispatch log states, and the
 * honest number there is what was SENT, not what was attached.
 */
const buildAskContextBlock = (
  context: AutocompleteAskContext | undefined,
): { block: string; length: number } => {
  const windowed = context?.text.slice(0, CONTEXT_WINDOW_CHARS) ?? "";
  if (!context || !windowed) return { block: "", length: 0 };
  return {
    block: `Context the user attached (${CONTEXT_SOURCE_LABELS[context.source]}):\n${windowed}\n\n`,
    length: windowed.length,
  };
};

/**
 * The press's environment lines as a labelled block, plus how much went out.
 *
 * LABELLED `background only` in the heading itself, not merely covered by the
 * system prompt's context rule: these lines are the most continuable thing on
 * the request. `App locale: en` invites `-US`, and a model that picks the block
 * up instead of the caret text produces a ghost the user would Tab into their
 * own question. The heading and the rule work together, exactly as they do for
 * the attached passage above.
 *
 * The block carries no fence of its own — see `buildAskDirectives` — which is
 * what makes the head-window below safe: a slice through a fenced block would
 * cut its closing delimiter and leave the caret text inside it.
 */
const buildEnvironmentBlock = (
  environment: string | undefined,
): { block: string; length: number } => {
  const windowed = environment?.slice(0, ENVIRONMENT_WINDOW_CHARS) ?? "";
  if (!windowed) return { block: "", length: 0 };
  return {
    block: `Environment at the time of the request (background only):\n${windowed}\n\n`,
    length: windowed.length,
  };
};

/**
 * Windows the surrounding text and frames it for the model.
 *
 * The prefix keeps its TAIL and the suffix keeps its HEAD: the caret is the only
 * position that matters, so truncation has to discard the text furthest from it.
 * Trimming the wrong end would hand the model context it cannot continue from.
 * The attached context is the contrasting case — see `CONTEXT_WINDOW_CHARS`.
 *
 * Whitespace is never trimmed — a trailing space is the difference between
 * continuing a word and starting the next one.
 *
 * The trailing label is `JSON:` rather than the old `Continuation:` for the same
 * reason the system prompt was rewritten: `Continuation:` is a prose cue, and
 * the observed failure was a model answering it with a sentence about why it
 * could not continue. `JSON:` cues a brace.
 *
 * WITH NEITHER AN ATTACHED CONTEXT NOR AN ENVIRONMENT THE OUTPUT IS
 * BYTE-IDENTICAL TO WHAT IT WAS BEFORE EITHER EXISTED. That is not politeness:
 * `service.ts` keys its cache on this exact string, so a heading, a blank line
 * or an "(none)" placeholder emitted for a bare question would invalidate every
 * cached suggestion and re-bill the cheapest path the feature has.
 */
export const buildAutocompletePrompt = ({
  prefix,
  suffix = "",
  context,
  environment,
}: AutocompletePromptInput): {
  systemPrompt: string;
  userPrompt: string;
  /** Characters of attached context actually placed in the prompt; `0` for none. */
  contextLength: number;
  /** Characters of the environment block actually placed in the prompt; `0` for none. */
  environmentLength: number;
} => {
  const windowedPrefix = prefix.slice(-PREFIX_WINDOW_CHARS);
  const windowedSuffix = suffix.slice(0, SUFFIX_WINDOW_CHARS);
  const askContext = buildAskContextBlock(context);
  const environmentBlock = buildEnvironmentBlock(environment);

  // The attached passage still leads the USER prompt so the caret text is the
  // LAST thing the model reads before `JSON:` — the position it continues from.
  // Environment directives used to live here too; they now ride the SYSTEM
  // prompt via `withUserMetadata` so presets and Autocomplete share one apply
  // function. Empty environment keeps both prompts byte-identical to the
  // pre-metadata shape (the cache key hashes both).
  const userPrompt = windowedSuffix
    ? `${askContext.block}Text before the caret:\n${windowedPrefix}\n\nText after the caret:\n${windowedSuffix}\n\nJSON:`
    : `${askContext.block}Text before the caret:\n${windowedPrefix}\n\nJSON:`;

  return {
    systemPrompt: withUserMetadata(
      AUTOCOMPLETE_SYSTEM_PROMPT,
      environmentBlock.block,
      "before-last-line",
    ),
    userPrompt,
    contextLength: askContext.length,
    environmentLength: environmentBlock.length,
  };
};
