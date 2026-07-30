/**
 * @file sanitize.ts
 * @description Makes a model's raw continuation safe to render as ghost text.
 *
 * Pure — no Electron. The output is inserted into a plain textarea verbatim on
 * Tab, so everything a chat-tuned model likes to add has to come off first.
 */

/** Longest suggestion shown. Beyond this it stops reading as a completion. */
export const MAX_SUGGESTION_CHARS = 200;

/**
 * C0 and C1 controls, keeping `\t` (0x09) and `\n` (0x0A).
 *
 * Same rationale as `parseActiveApp` (`~/main/accessibility/activeApp`): a
 * control character that reaches the DOM is invisible in review yet changes what
 * the text is, and a lone `\r` would survive into the textarea value as a
 * phantom line break.
 */
// eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** A leading fence, with or without a language tag, plus its closing partner. */
const LEADING_FENCE = /^\s*```[^\n]*\n?/;
const TRAILING_FENCE = /\n?```\s*$/;

const TRAILING_WHITESPACE = /\s+$/;

const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["`", "`"],
];

/**
 * Strips one matched pair of wrapping quotes.
 *
 * Only a matched pair, and only when the closing quote ends the string —
 * otherwise a continuation that legitimately opens a quotation (`he said "yes`)
 * would lose the character the user actually wanted.
 */
const stripWrappingQuotes = (text: string): string => {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > open.length && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length);
    }
  }
  return text;
};

/**
 * Returns a renderable suggestion, or `null` when there is nothing to show.
 *
 * `null` rather than `""` so the caller has one unambiguous "no suggestion"
 * signal and cannot render an empty ghost that still swallows Tab.
 *
 * Leading whitespace survives, trailing whitespace does not: the model often has
 * to open with a space to continue after a word, but a trailing space would put
 * the caret past a gap the user never typed.
 */
export const sanitizeSuggestion = (raw: unknown): string | null => {
  if (typeof raw !== "string") {
    return null;
  }

  const unfenced = raw.replace(LEADING_FENCE, "").replace(TRAILING_FENCE, "");
  const unquoted = stripWrappingQuotes(
    unfenced.replace(CONTROL_CHARACTERS, "").replace(TRAILING_WHITESPACE, ""),
  );
  const capped = unquoted.slice(0, MAX_SUGGESTION_CHARS).replace(TRAILING_WHITESPACE, "");

  return capped.length > 0 ? capped : null;
};
