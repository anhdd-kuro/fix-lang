/**
 * @file parseReply.ts
 * @description Turns a model's raw reply into a suggestion, or into nothing.
 *
 * Pure — no Electron. Reads one contract and one only:
 *
 *     {"suggestion": "<the continuation>"}
 *
 * THE PROPERTY THIS FILE EXISTS FOR, and it is not the format. ANYTHING THAT
 * DOES NOT PARSE AS THAT EXACT SHAPE YIELDS NO SUGGESTION. Refusal prose is not
 * JSON, so it cannot reach the UI by construction rather than by a heuristic
 * that has to anticipate how each model phrases a refusal.
 *
 * WHY, in the words of the running app. A 3-character prefix (`tes`) against a
 * 9B local model returned, AS THE SUGGESTION:
 *
 *     Nothing to continue here as the input text "tes" appears to be an
 *     incomplete word or fragment without clear context for further
 *
 * and, on another run, `nothing at all, as there is no clear context or
 * narrative to continue.` — the model CONTINUING the old prompt's closing
 * instruction as prose instead of obeying it. That text rendered as ghost text,
 * one Tab press from being inserted into the user's own question. Both strings
 * are pinned verbatim in the tests beside this file.
 *
 * HOW LENIENT, and where the line is drawn. Leniency here is a direct trade
 * against the property above: every shape accepted is a shape a refusal could
 * arrive in. So exactly ONE accommodation is made, for PACKAGING rather than
 * for content — a single markdown code fence around the object, which chat-tuned
 * models add reflexively and which is not the model disagreeing about the
 * contract. Everything else is refused:
 *
 * - NOT prose before or after the object. Scanning for the first `{` would
 *   accept `Sorry, I cannot continue that. {"suggestion":""}` and, worse, would
 *   accept the same reply with a real suggestion glued to an apology — and it
 *   trades a whole-string parse (the property) for compatibility with a model
 *   that has already broken the contract.
 * - NOT single quotes, unquoted keys, or trailing commas. Those are not JSON,
 *   and a parser lenient enough to read them is lenient enough to read a
 *   sentence containing a brace.
 * - NOT a bare JSON string (`"the rest of it"`). Valid JSON, wrong shape: the
 *   envelope is what distinguishes an answer from a model that ignored the
 *   instruction and emitted raw text, which is the failure being fixed.
 *
 * A TRUNCATED reply therefore yields nothing rather than a partial string —
 * `JSON.parse` throws on an unclosed string, which is the correct answer.
 *
 * The request carries no output-token ceiling, so truncation is no longer
 * something the caller inflicts on a well-behaved model; it is what a provider's
 * own limit does to one that would not stop. Either way the answer is the same:
 * a half-written envelope is not a suggestion. That also makes this parse the
 * bound on a RAMBLING model — the length rule lives in the system prompt now,
 * and a prompt is a request, not a limit.
 */

/** The one field read out of the reply. Everything else in the object is ignored. */
export const AUTOCOMPLETE_REPLY_FIELD = "suggestion";

/**
 * `ok: false` is "the model did not answer in the contract" — a model or
 * configuration fault worth a log line. `ok: true` with an empty `suggestion`
 * is "the model answered, and has nothing to suggest", which is routine and
 * silent. The caller must be able to tell those apart; collapsing both to
 * `null` would hide a broken model behind an ordinary quiet moment.
 */
export type AutocompleteReplyParse = { ok: true; suggestion: string } | { ok: false };

const REFUSED: AutocompleteReplyParse = { ok: false };

/** One fenced block and nothing outside it, with or without a language tag. */
const FENCED_BLOCK = /^```[^\n]*\n([\s\S]*?)\n?```$/;

const unwrapFence = (text: string): string => {
  const fenced = FENCED_BLOCK.exec(text);
  return fenced ? fenced[1].trim() : text;
};

/**
 * Extracts the suggestion, or refuses.
 *
 * The returned string is NOT yet safe to render: it is model output that has
 * only been proven to be a JSON string. `sanitizeSuggestion` still has to run on
 * it — a JSON escape smuggles a control character through a parse that leaves no
 * trace of it in the raw reply (a six-character BEL escape inside a JSON
 * string is well formed, and decodes to one invisible byte), which is why
 * parsing happens first and sanitising second.
 */
export const parseAutocompleteReply = (raw: unknown): AutocompleteReplyParse => {
  if (typeof raw !== "string") return REFUSED;

  const candidate = unwrapFence(raw.trim());
  if (!candidate) return REFUSED;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return REFUSED;
  }

  // An array is `typeof "object"` too, and `null` most of all.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return REFUSED;

  const value = (parsed as Record<string, unknown>)[AUTOCOMPLETE_REPLY_FIELD];
  // A number, an object, an array or `null` is not a suggestion. Only a string
  // is, and an empty one means "nothing to suggest" — the contract's own way of
  // declining, which is what replaced the prose instruction that caused this.
  return typeof value === "string" ? { ok: true, suggestion: value } : REFUSED;
};
