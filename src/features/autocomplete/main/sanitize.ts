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
 *
 * It takes the PREFIX as well as the suggestion, because one class of unsafe
 * content is only visible next to the text the suggestion will be appended to —
 * see `stripPrefixOverlap`.
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
 * How far back into the prefix the overlap comparison may look.
 *
 * A bound is needed because the prefix is the user's WHOLE typed text, while the
 * thing being looked for is a re-emission of what sits at the caret. 80
 * characters is roughly thirteen English words, comfortably more than the
 * fifteen-word reply the system prompt asks for, so a re-emission this window
 * cannot cover would have to be a reply that is almost entirely a copy of the
 * input — and the answer there is the status quo (strip nothing), never a guess.
 *
 * Counted in characters rather than words so the scan costs the same whatever
 * the user has typed, including a paste with no spaces in it at all.
 *
 * Well inside `PREFIX_WINDOW_CHARS` (600), so this compares against exactly the
 * text the model was shown: the last 80 characters of the prefix are the last 80
 * characters of the windowed prompt too.
 */
export const OVERLAP_LOOKBACK_CHARS = 80;

/** Letters, digits and `_`, unicode-aware — `\w` alone would call `é` a boundary. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && WORD_CHARACTER.test(character);

/** A word character whose left neighbour is not one; the string's start counts. */
const isWordStart = (text: string, index: number): boolean =>
  isWordCharacter(text[index]) && !isWordCharacter(text[index - 1]);

/**
 * Removes a leading re-spelling of text the user has already typed.
 *
 * THE MEASURED DEFECT. The system prompt asks for the fragment to APPEND and
 * carries a literal example of it (`"tes" -> {"suggestion":"t"}, not "test"`).
 * The model usually complies — and roughly one reply in eight from
 * `ornith-1.0-9b` still returns the whole word, `{"suggestion":"test"}`. Nothing
 * downstream compared the two, so the ghost painted `tes` + `test` = `testest`
 * and Tab inserted exactly that into the user's question: silent corruption of
 * an input surface by untrusted model output. The prompt is a REQUEST; this is
 * the enforcement point — the same split `parseReply.ts` already makes for the
 * envelope, and the same reason it exists.
 *
 * It removes redundant characters and nothing else. Whether the continuation is
 * any GOOD is not a question a deterministic guard can answer, and it does not
 * try.
 *
 * EVERY CLAUSE OF THE RULE IS THERE TO PROTECT A LEGITIMATE REPEAT. Real text
 * repeats words — `had had`, `that that`, `New York, New York` — and a guard
 * that ate a genuine continuation because it opened with a word already on
 * screen would be worse than the bug it fixes.
 *
 * 1. THE CARET MUST SIT INSIDE A WORD. A prefix ending on a space or a mark
 *    means the user has FINISHED a word, and a suggestion repeating it produces
 *    ordinary English the user can read and decline by not pressing Tab. Only a
 *    caret inside a word can be glued into a non-word (`testest`), which is the
 *    entire damage here. So `he had ` + `had enough` is left exactly alone.
 *
 * 2. THE OVERLAP RUNS FROM A WORD START TO THE CARET. No word start exists
 *    inside the trailing partial word, so any candidate covers the whole of it:
 *    the model re-spelled at least the word it was asked to finish, which is
 *    what re-emission MEANS. This also defends the repeat case a second time and
 *    independently — `he had` + ` had enough` cannot match, because every
 *    candidate begins with a word character and that suggestion begins with a
 *    space. The separator carries the meaning: with the caret mid-word, a
 *    re-spelling with no separator is redundancy, and the same words WITH one
 *    are the next word.
 *
 *    It is also why offsets INSIDE the trailing word are refused, tempting as
 *    they are (`the do` + `og barks`). A one-letter coincidence — `I like tea` +
 *    `a lot`, a model that simply forgot its leading space — would then delete a
 *    word the model meant to ADD. Missing an overlap costs a visibly wrong ghost
 *    the user ignores; inventing one edits their text.
 *
 * 3. LONGEST WINS. `test tes` + `test tester` must become `ter`; the shortest
 *    match would strip `tes` alone and leave `test test tester`.
 *
 * 4. CASE-INSENSITIVE, and only the SUGGESTION loses characters. `tes` + `Test`
 *    is the same defect wearing different capitals, so the comparison folds
 *    case — but the prefix is the user's own text and is never rewritten, so
 *    `tes` + `Testing` yields `tes` + `ting`, model casing governing only the
 *    characters it actually adds. Candidate and head are folded as EQUAL-LENGTH
 *    slices rather than folding the whole suggestion once: a fold that changes
 *    length (`İ` becomes two code units) then fails to match instead of slicing
 *    at an index that no longer means what it did.
 *
 * Scripts written without spaces get only partial cover: a run of kana or hanzi
 * has one word start, so a re-emission of the whole run is stripped and a
 * re-emission of its tail is not. That is a miss, which is the safe direction.
 */
const stripPrefixOverlap = (suggestion: string, prefix: string): string => {
  if (!isWordCharacter(prefix[prefix.length - 1])) return suggestion;

  const earliestStart = Math.max(0, prefix.length - OVERLAP_LOOKBACK_CHARS);
  // Ascending, so the first match found is the longest overlap. Indices are into
  // the whole prefix, never into a copy of the window: a window edge landing
  // mid-word must not read as a word start.
  for (let start = earliestStart; start < prefix.length; start += 1) {
    if (!isWordStart(prefix, start)) continue;
    const overlapLength = prefix.length - start;
    if (overlapLength > suggestion.length) continue;
    if (
      prefix.slice(start).toLowerCase() === suggestion.slice(0, overlapLength).toLowerCase()
    ) {
      return suggestion.slice(overlapLength);
    }
  }
  return suggestion;
};

/**
 * Returns a renderable suggestion, or `null` when there is nothing to show.
 *
 * `null` rather than `""` so the caller has one unambiguous "no suggestion"
 * signal and cannot render an empty ghost that still swallows Tab. A suggestion
 * the overlap guard empties — the model returned exactly what was already
 * typed — reaches the caller through that same `null`, so it paints no ghost and
 * offers no Tab affordance rather than an empty one.
 *
 * `prefix` is REQUIRED, with no default. It is the text the suggestion will be
 * appended to, and a call site that could omit it would silently opt out of
 * `stripPrefixOverlap` while still reading as sanitised.
 *
 * Leading whitespace survives, trailing whitespace does not: the model often has
 * to open with a space to continue after a word, but a trailing space would put
 * the caret past a gap the user never typed.
 */
export const sanitizeSuggestion = (raw: unknown, prefix: string): string | null => {
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
  // LAST of the removals, and after the unquoting rather than before it: the
  // overlap has to be compared against what will actually be painted, so a
  // re-emission arrives here already free of the fence, the quotes and any
  // invisible character that would otherwise hide it from the comparison. The
  // cap that follows only ever removes from the tail, so it cannot resurrect one.
  const deduplicated = stripPrefixOverlap(unquoted, prefix);
  const capped = deduplicated.slice(0, MAX_SUGGESTION_CHARS).replace(TRAILING_WHITESPACE, "");

  return capped.length > 0 ? capped : null;
};
