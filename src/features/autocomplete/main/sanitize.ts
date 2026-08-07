/**
 * @file sanitize.ts
 * @description Makes a model's continuation safe to render as ghost text.
 *
 * Pure — no Electron. The output is inserted into a plain textarea verbatim on
 * Tab, so everything a chat-tuned model likes to add has to come off first.
 *
 * Runs on the string `parseReply.ts` extracted from the JSON envelope, never on
 * the raw reply, and it is still needed after that parse: a JSON string is only
 * proof of well-formed JSON, not of safe content — control characters, fences
 * and markup all survive `JSON.parse` intact, and a unicode escape arrives in
 * the raw reply looking like six ordinary characters and decodes to one
 * invisible one.
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

/**
 * A COMPLETE markdown image: `![alt](url)`.
 *
 * Ghost text is painted through a plain mirror `<span>` and accepted into a
 * plain textarea, so this never renders as an image today — the guarantee is
 * that it cannot START to. `![` is not something a continuation of the user's
 * half-written sentence can legitimately contain, so a reply carrying it has
 * stopped continuing prose and started authoring markdown; a future surface that
 * renders the accepted text (the Ask answer already renders GFM) would then be
 * fetching a remote URL the model chose.
 *
 * LINKS are deliberately left alone. `[text](url)` renders as literal characters
 * everywhere a suggestion can reach, it fetches nothing on its own, and
 * bracketed text followed by a parenthesis is ordinary prose a user may well be
 * mid-way through typing. Stripping it would delete characters they wanted.
 *
 * Newline-free classes on both halves so an unterminated `![` cannot swallow the
 * rest of a multi-line suggestion.
 */
const MARKDOWN_IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;

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
    unfenced
      .replace(CONTROL_CHARACTERS, "")
      .replace(MARKDOWN_IMAGE, "")
      .replace(TRAILING_WHITESPACE, ""),
  );
  const capped = unquoted.slice(0, MAX_SUGGESTION_CHARS).replace(TRAILING_WHITESPACE, "");

  return capped.length > 0 ? capped : null;
};
