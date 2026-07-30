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
 * The rules are all about what NOT to emit. A chat-tuned model's instinct is to
 * acknowledge, quote back, or wrap output in prose or fences; any of those
 * render as literal garbage in ghost text, because the suggestion is inserted
 * into a plain textarea verbatim.
 */
export const AUTOCOMPLETE_SYSTEM_PROMPT = `You continue the user's partially written text.

Rules:
- Output only the continuation. Never repeat the text you were given.
- Continue from exactly where the text stops, mid-word if it stops mid-word.
- Match the language, tone, and register already in use.
- Write at most one sentence, and stop at the end of the thought.
- No quotes around the output, no markdown, no code fences, no commentary, no preamble.
- If a sensible continuation is not obvious, output nothing at all.`;

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
 */
export const buildAutocompletePrompt = ({
  prefix,
  suffix = "",
}: AutocompletePromptInput): { systemPrompt: string; userPrompt: string } => {
  const windowedPrefix = prefix.slice(-PREFIX_WINDOW_CHARS);
  const windowedSuffix = suffix.slice(0, SUFFIX_WINDOW_CHARS);

  const userPrompt = windowedSuffix
    ? `Text before the caret:\n${windowedPrefix}\n\nText after the caret:\n${windowedSuffix}\n\nContinuation:`
    : `Text before the caret:\n${windowedPrefix}\n\nContinuation:`;

  return { systemPrompt: AUTOCOMPLETE_SYSTEM_PROMPT, userPrompt };
};
