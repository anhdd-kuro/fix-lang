/**
 * @file secretRules.ts
 * @description The credential shapes the secret guard looks for.
 *
 * Pure and electron-free: no store, no i18n, no logging. Everything the guard
 * decides is decided from these rules plus the text in front of it, so the
 * whole detector is verifiable offline.
 *
 * A rule never reports the text it matched — see `SecretMatch` in
 * `detectSecrets.ts`. This file only says WHERE to look and WHAT counts.
 */

export type SecretRuleId =
  | "private-key-block"
  | "url-credentials"
  | "authorization-header"
  | "anthropic-key"
  | "openrouter-key"
  | "openai-key"
  | "aws-access-key-id"
  | "github-token"
  | "slack-token"
  | "google-api-key"
  | "gitlab-token"
  | "stripe-secret-key"
  | "npm-token"
  | "shopify-token"
  | "digitalocean-token"
  | "jwt"
  | "credential-assignment"
  | "high-entropy-string";

/**
 * `"match"` spans the whole match. `"value"` spans the named group `value`,
 * which by convention is preceded by the named group `lead` covering
 * everything from the match start — so the offset is arithmetic rather than a
 * fragile `indexOf` that would land on the wrong copy of a repeated value.
 */
export type SecretRuleSpan = "match" | "value";

export type SecretRuleContext = {
  /** The text the span covers. Never leaves the detector. */
  value: string;
  /** The full scanned text, for look-around a regex cannot express cheaply. */
  text: string;
  /** Absolute offset of the span inside `text`. */
  start: number;
  /** Named capture groups of the raw match, if any. */
  groups: Record<string, string | undefined>;
};

export type SecretRule = {
  id: SecretRuleId;
  /** Always global; cloned per scan so `lastIndex` can never leak between scans. */
  pattern: RegExp;
  span: SecretRuleSpan;
  /** Higher wins when two spans overlap. */
  priority: number;
  /** Second stage: a regex says "shaped like", this says "is". */
  accept?: (context: SecretRuleContext) => boolean;
  /**
   * Whether the WIDENED span covers the whole credential under every reading
   * the surrounding text allows, so replacing it leaves none of the secret in
   * the outgoing text. Absent means yes: a rule with a fixed shape or an
   * explicit terminator knows exactly where its credential ends. Only
   * `credential-assignment` is ever in doubt.
   *
   * Runs only on accepted matches; the result is a BOOLEAN on `SecretMatch`, so
   * the no-matched-text guarantee is untouched.
   */
  maskable?: (context: SecretRuleContext) => boolean;
  /**
   * How many extra characters to fold into the reported span on each side,
   * beyond the captured `value`. Only `credential-assignment` ever needs this:
   * its value class excludes quote characters outright, so a credential that
   * itself begins and ends with the exact quote character an assignment
   * happened to use cannot be represented by that class at all. Absent means
   * zero: every other rule's span already IS the credential.
   *
   * Widening is what makes `maskable` answerable without guessing — see
   * `spanWidening`. It runs on accepted matches BEFORE `maskable`, which reads
   * the character after the widened end.
   */
  widen?: (context: SecretRuleContext) => { before: number; after: number };
  /** Rules the user must switch on explicitly. */
  optIn?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Placeholder vocabulary (shared with maskSecrets.ts)                         */
/* -------------------------------------------------------------------------- */

export const SECRET_PLACEHOLDER_MARKER = "FIXLANG_SECRET_";

export const buildSecretPlaceholder = (salt: string, index: number): string =>
  `[[${SECRET_PLACEHOLDER_MARKER}${salt}_${String(index).padStart(2, "0")}]]`;

/* -------------------------------------------------------------------------- */
/* Second-stage helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The words that make a name a credential name. `credential-assignment` builds
 * its name gate FROM this set rather than restating it, so a word added here
 * cannot silently stop matching.
 */
export const CREDENTIAL_NAME_SEGMENTS = new Set([
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "credential",
]);

/**
 * `credential-assignment` is two-stage because a single `/i` regex matching
 * `KEY` also matches inside `monkey`, `donkey` and `turkey`. A name only counts
 * when a WHOLE segment is a credential word, so the name is split on
 * separators AND on camel humps before the lookup.
 */
export const isCredentialName = (name: string): boolean =>
  name
    .split(/[_.\-\s]+/)
    .flatMap((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(" "),
    )
    .some((segment) => CREDENTIAL_NAME_SEGMENTS.has(segment.toLowerCase()));

/* -------------------------------------------------------------------------- */
/* `credential-assignment`'s name gate                                         */
/* -------------------------------------------------------------------------- */

/**
 * A regex that lets the engine reject a name BEFORE it consumes a value.
 *
 * `isCredentialName` is the authority, but it only runs after the regex has
 * already swallowed the value, so a document full of `monkey=`, `apikey=` or
 * `secrets=` used to cost one full scan of the remaining text per name —
 * 13 to 37 SECONDS of frozen main process on half a megabyte. This gate has to
 * agree with `isCredentialName` closely enough that those names never reach it,
 * while staying a SUPERSET so it can never turn an accept into a silent miss.
 *
 * Case is what makes that possible. `isCredentialName` splits camel humps with
 * `([a-z0-9])([A-Z])` and `([A-Z]+)([A-Z][a-z])`, and those splits mean only
 * three casings of a word can survive as a whole segment: `key`, `Key`, `KEY`.
 * `kEy` splits to `k`/`Ey`, `KEy` to `K`/`Ey`, and so on. So the gate spells the
 * three out (the pattern is case-SENSITIVE, unlike its predecessor) and each
 * carries the boundary that casing implies:
 *
 * - all-lower must start a segment, so no letter or digit may precede it —
 *   this is what `apikey` and `monkey` fail;
 * - any of them may be followed by an uppercase letter (a camel hump) but never
 *   by a lowercase letter or digit — this is what `secrets`, `tokenizer` and
 *   `keyword` fail;
 * - all-upper may follow a lowercase letter or a digit (`monkeyKEY` really is a
 *   credential name) but not an uppercase one — this is what `MONKEY` fails —
 *   and may only be followed by `[A-Z][a-z]`, since `TOKENS` and `KEYS` are one
 *   uppercase run and therefore one segment.
 *
 * `detectSecrets.test.ts` re-derives the agreement from `isCredentialName`
 * itself over a generated corpus of names; that test, not this comment, is what
 * keeps the two in step.
 */
const CREDENTIAL_WORDS: readonly string[] = [...CREDENTIAL_NAME_SEGMENTS];

const capitalize = (word: string): string => `${word[0].toUpperCase()}${word.slice(1)}`;

/**
 * Every alternative below begins with one of these, so the engine can rule an
 * offset out on ONE character instead of on twenty-one literal alternatives.
 * Derived, so it cannot drift from the word list; implied by every alternative,
 * so it cannot cost recall. Worth 2-3x on the gate under JavaScriptCore, which
 * is what runs the tests, and it is free under V8, which is what ships.
 */
const CREDENTIAL_WORD_INITIALS = [
  ...new Set(CREDENTIAL_WORDS.flatMap((word) => [word[0], word[0].toUpperCase()])),
].join("");

const CREDENTIAL_NAME_GATE = [
  `(?=[A-Za-z0-9_.-]{0,63}?(?=[${CREDENTIAL_WORD_INITIALS}])(?:`,
  `(?<![A-Za-z0-9])(?:${CREDENTIAL_WORDS.join("|")})(?![a-z0-9])`,
  `|(?:${CREDENTIAL_WORDS.map(capitalize).join("|")})(?![a-z0-9])`,
  `|(?<![A-Z])(?:${CREDENTIAL_WORDS.map((word) => word.toUpperCase()).join("|")})`,
  "(?:(?![A-Za-z0-9])|(?=[A-Z][a-z]))",
  "))",
].join("");

/* -------------------------------------------------------------------------- */
/* `credential-assignment`'s value gate                                        */
/* -------------------------------------------------------------------------- */

/**
 * The characters the value's character class stops on. The class is the whole
 * of what the REGEX knows; whether stopping there was a real boundary or a cut
 * through a credential is decided by `endsAtValueBoundary`, and a cut is
 * rejected rather than reported.
 *
 * NOTHING MAY BE ADDED HERE, because a character in this class that also occurs
 * inside real credentials is a partial mask waiting to happen: the masker
 * replaces the head, leaves the tail in the outgoing text beside the
 * placeholder, and reports success. Rounds 2 and 3 each added one to fix a
 * swallow and bought exactly that. `,` and `;` were here from the start for
 * connection strings and were the same defect (`password=Passw0rd;More1234`
 * masked `Passw0rd` and sent `;More1234`); they are gone, and the cost is that
 * the trailing `;` of a connection string's last parameter is masked with the
 * value, which the restore puts back byte-exactly.
 */
const VALUE_STOP = /[\s"'`]/;

const VALUE_QUOTE = /["'`]/;

/**
 * An upper bound on how much text one value may consume, so a rejected
 * candidate cannot cost a scan of the whole document. It is NOT a truncation:
 * a value that reaches it is followed by more value-shaped text, which
 * `endsAtValueBoundary` reads as a cut and rejects.
 */
export const MAX_CREDENTIAL_VALUE_LENGTH = 2048;

/**
 * How far back the quote-parity check reads. Bounded because it runs per
 * candidate: an unbounded walk to the start of a line makes a document of
 * `password=aaaaaa'` repeated quadratic, which is the exact defect the scheme
 * bound in `url-credentials` was added to kill. Every quoting shape this has to
 * recognise — a JSON member, an HTML attribute, a shell argument — puts its
 * opening quote a few dozen characters back at most.
 *
 * Reaching the bound means the parity is UNKNOWN, and unknown resolves to "not
 * open", i.e. to rejecting the candidate. A credential quoted from further away
 * than this is a miss; a wrong guess the other way is a partial mask.
 */
const QUOTE_PARITY_LOOKBACK_CHARS = 256;

/**
 * Whether the value sits inside an open `quote` — an ODD number of them between
 * the start of the line and the start of the value.
 *
 * This is the difference between a quote that CLOSED the value and a quote that
 * merely STOPPED the character class. `{"url": "…?password=abc123"}` has three
 * `"` before the value, so the fourth closes the string the credential lives in;
 * ``password={5GzCbw2NNxMw<`;F>q7{`` has none before it, so its backtick is a
 * character of the password and the span would have covered 14 of 21.
 */
const sitsInsideOpenQuote = (text: string, valueStart: number, quote: string): boolean => {
  const limit = valueStart - QUOTE_PARITY_LOOKBACK_CHARS;
  let count = 0;
  for (let index = valueStart - 1; index >= 0 && index >= limit; index -= 1) {
    const character = text[index];
    if (character === "\n" || character === "\r") return count % 2 === 1;
    if (character === quote) count += 1;
  }
  return limit <= 0 && count % 2 === 1;
};

/**
 * Whether a quote at `index - 1` was followed by more of the value rather than
 * by structure. Every syntax that quotes a value follows the closing quote with
 * punctuation, whitespace or nothing — `"…"}`, `"…",`, `"…" #`, `"…">` — so an
 * alphanumeric there says the quote was a character INSIDE the credential and
 * the span would have covered only part of it.
 */
const isFollowedByValueText = (text: string, index: number): boolean => {
  const character = text[index];
  return character !== undefined && /[A-Za-z0-9]/.test(character);
};

/**
 * Whether the value stopped where the value really ends, rather than being cut.
 *
 * This is what makes "in full or not at all" a property of the rule instead of
 * a hope about character classes. A cut candidate is a MISS — no dialog, text
 * sent as it stands, which is what already happens for every shape the detector
 * does not recognise. A cut SPAN would instead hand the provider most of a live
 * credential under a green label.
 *
 * - If the value was OPENED by a quote, that same quote is the only thing that
 *   can close it. This is what stops `db_password: "Correct Horse Battery"`
 *   from masking `Correct` and sending ` Horse Battery"` — the value class
 *   stops at the space, and the space is not the boundary the quote promised.
 *   THIS CLAUSE RUNS BEFORE THE END-OF-TEXT ONE, because end of text is not a
 *   closing quote either. `password="Q9:&i{3b+(u}1585` at the end of the
 *   selection is either a password that begins with a quote — in which case
 *   masking from the second character leaves the first beside the placeholder —
 *   or a quoted value the selection cut short. Both are cuts, and taking the
 *   quote as an opener cost one leaked character on 1.9 % of KeePass-alphabet
 *   passwords.
 * - End of text otherwise ends a value; nothing was cut.
 * - Otherwise whitespace ends it. An unquoted passphrase with a space in it
 *   (`password=correct horse battery`) is cut here and always was, because
 *   whitespace is the only thing standing between `password=` and the rest of
 *   the document, and rejecting every such value costs 39 % of real credential
 *   lines. It is accepted and reported NOT MASKABLE instead — see
 *   `spanCoversCredential`.
 * - Otherwise a quote ends it only if the value was sitting INSIDE that quote:
 *   an odd count of it between the start of the line and the start of the
 *   value. Guessing from the character AFTER the quote instead was the same
 *   terminator-guessing this function exists to remove — a password whose quote
 *   is followed by punctuation read as closed, and 11.6 % of KeePass-alphabet
 *   passwords were masked in part. The follower test is kept as a second
 *   condition, since it can only add rejections.
 * - Anything else means the maximum length cut the value short.
 */
const endsAtValueBoundary = (
  text: string,
  valueStart: number,
  valueEnd: number,
  quote: string,
): boolean => {
  const next = text[valueEnd];
  if (quote !== "") return next === quote && !isFollowedByValueText(text, valueEnd + 1);
  if (next === undefined) return true;
  if (VALUE_STOP.test(next) && !VALUE_QUOTE.test(next)) return true;
  if (!VALUE_QUOTE.test(next)) return false;
  if (!sitsInsideOpenQuote(text, valueStart, next)) return false;
  return !isFollowedByValueText(text, valueEnd + 1);
};

/** A line break ends a value beyond any doubt; no credential spans one. */
const LINE_BREAK = /[\r\n\u2028\u2029]/;

/**
 * How far the reported span reaches past the captured `value` on each side.
 *
 * A quoted value is ALWAYS widened over its boundary quotes, with no test of
 * whether those quotes were really delimiters. That question has no local
 * answer and does not need one, because widening covers the credential under
 * BOTH readings:
 *
 * - quotes are delimiters — the span is a SUPERSET of the credential, which is
 *   never a leak (masking more is safe) and never a corruption (`restoreSecrets`
 *   puts back exactly the span text, so `'abc'` round-trips to `'abc'`);
 * - quotes are characters of the credential (`password='{)Qj,5]s'`, whose real
 *   password IS `'{)Qj,5]s'`) — the span is EXACT.
 *
 * Three rounds tried instead to CORROBORATE the closing quote from a nearby
 * character: a comma, a bracket, a colon separator, a quoted name. Every one of
 * those is in the KeePass alphabet, so the corroboration is forgeable by the
 * password itself, and the last such table still reported 12 truncations per
 * 100 000 as fully maskable.
 */
const spanWidening = (quote: string): { before: number; after: number } => ({
  before: quote.length,
  after: quote.length,
});

/**
 * How far back the URL-authority reading is checked for a competing one.
 * Bounded because it runs per accepted match; no real DSN puts its scheme
 * further than this from its password.
 */
const URL_AUTHORITY_LOOKBACK_CHARS = 256;

/**
 * Whether another `://` appears before this one inside the same whitespace-
 * delimited run, which means the rule PICKED one of two readings of where the
 * authority begins.
 *
 * `postgres://user://+PUIr~G:15]3@host:5432/db` is a DSN whose password is
 * `//+PUIr~G:15]3`. The value class excludes `/`, so the honest reading cannot
 * match at all — but `user://+PUIr~G:15]3@` reads as a whole second URL, and the
 * rule then reports `15]3` as a complete password and leaves `//+PUIr~G:` in the
 * outgoing text. One per 100 000 KeePass-alphabet passwords, and the only shape
 * in this rule where the span is a truncation rather than a miss.
 *
 * The competing reading cannot be resolved locally, so it is not resolved: the
 * match is still reported and comes back `maskable: false`, which downgrades the
 * request to a confirm. The cost is that a genuine URL nested in another URL's
 * query string is confirmed rather than masked.
 */
const authorityReadingIsAmbiguous = (text: string, matchStart: number): boolean => {
  const limit = Math.max(0, matchStart - URL_AUTHORITY_LOOKBACK_CHARS);
  let runStart = matchStart;
  while (runStart > limit && !/\s/.test(text[runStart - 1])) runStart -= 1;
  return text.slice(runStart, matchStart).includes("://");
};

/**
 * Whether the WIDENED span covers the whole credential under every reading the
 * surrounding text allows.
 *
 * One question, asked of one character: what follows the span. A line break or
 * end of text is something a generated credential provably cannot contain, so
 * no reading lets the credential continue past it. NOTHING ELSE qualifies —
 * not a comma, not a bracket, not a space, not a quote — because each of those
 * is a character a password may contain, and accepting one is exactly the guess
 * that made `password='qgRSE9ST):l'>$M` report `'qgRSE9ST):l'` as fully
 * maskable while `>$M` stayed beside the placeholder, and that let a markdown
 * or JSON wrapper (160 and 188 per 5 000 KeePass passwords) do the same.
 *
 * The costs are real and deliberate. `password=Correct Horse Battery` stops at
 * a space, `PASSWORD="hunter2Abc" # rotate` at a space, `const s = 'hunter2';`
 * at a semicolon — all three are still reported, all three come back
 * `maskable: false`, and the gate downgrades them to a confirm. Over-confirming
 * is friction the user clears in one click; a false `maskable: true` is a
 * silent partial leak under a green label.
 */
const spanCoversCredential = (text: string, valueEnd: number, quote: string): boolean => {
  const next = text[valueEnd + quote.length];
  return next === undefined || LINE_BREAK.test(next);
};

/**
 * The scripts written without inter-word spaces. Japanese prose carries no
 * ASCII space, comma or semicolon, so `password=` followed by a Japanese
 * document ran to the end of it: the model saw a 37-character request, the
 * restore put the original back byte-exactly, and the user's Correction was a
 * silent no-op reported as "1 credential masked". FixLang ships Japanese.
 *
 * A value containing one of these is PROSE the assignment ran into, not a
 * credential — no credential is written in any of these scripts — so the whole
 * candidate is rejected. The alternative, ending the value at the first such
 * character, cuts a mixed-script passphrase (`password=abc123パスワード456`) in
 * half and sends the rest to the provider.
 *
 * The cost is stated plainly because it is real: an ASCII credential written
 * hard against Japanese prose with no space between them
 * (`api_key=s3cr3tV4lu3XYZお問い合わせは…`) is now a miss rather than a mask.
 * Locally that input is indistinguishable from a mixed-script passphrase, and a
 * miss leaves the user exactly where they were while a cut hands the provider
 * most of a credential under a green label.
 */
const SPACELESS_SCRIPT_CHARACTER =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}\u3000-\u303F\uFF00-\uFFEF]/u;

const PLACEHOLDER_WORDS = new Set([
  "null",
  "none",
  "nil",
  "undefined",
  "changeme",
  "change_me",
  "example",
  "placeholder",
  "redacted",
  "todo",
  "xxxxxx",
  "yourkeyhere",
  "your_key_here",
  "your-key-here",
]);

/**
 * Flagging a template stub manufactures a false positive, and false positives
 * are what train users to click *Send anyway* on the one that matters.
 */
export const isPlaceholderValue = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (PLACEHOLDER_WORDS.has(trimmed.toLowerCase())) return true;
  if (/^<.*>$/.test(trimmed)) return true;
  if (/^\{\{.*\}\}$/.test(trimmed)) return true;
  if (/^%.*%$/.test(trimmed)) return true;
  if (trimmed.startsWith("$")) return true;
  if (new Set(trimmed).size <= 2) return true;
  return false;
};

const shannonEntropy = (value: string): number => {
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
};

const MIN_ENTROPY_BITS_PER_CHAR = 4;
const MIN_ENTROPY_LENGTH = 32;
const MAX_ENTROPY_LENGTH = 256;
const MIN_DISTINCT_CHARS = 12;

/**
 * Pure hex is excluded ENTIRELY, dashes included so UUIDs go with it. Random
 * 40-hex sits at H≈3.74 and 64-hex at H≈3.67 — no threshold separates a git SHA
 * from a hex credential, and every hex credential that exists in practice
 * carries a prefix one of the rules above already matches. Recall cost ≈ 0;
 * false positives avoided: enormous.
 */
const isPureHexOrUuid = (value: string): boolean => /^[0-9a-f-]+$/i.test(value);

const isSubresourceIntegrity = (value: string): boolean =>
  /^(?:sha(?:256|384|512)|md5)-/i.test(value);

const isDataUriPayload = (text: string, start: number): boolean =>
  text.slice(Math.max(0, start - "base64,".length), start).toLowerCase() === "base64,";

const characterClassCount = (value: string): number =>
  (/[a-z]/.test(value) ? 1 : 0) + (/[A-Z]/.test(value) ? 1 : 0) + (/\d/.test(value) ? 1 : 0);

export const acceptHighEntropyString = ({ value, text, start }: SecretRuleContext): boolean => {
  if (value.length < MIN_ENTROPY_LENGTH || value.length > MAX_ENTROPY_LENGTH) return false;
  if (isPureHexOrUuid(value)) return false;
  if (isSubresourceIntegrity(value)) return false;
  if (isDataUriPayload(text, start)) return false;
  if (new Set(value).size < MIN_DISTINCT_CHARS) return false;
  if (characterClassCount(value) < 2) return false;
  return shannonEntropy(value) >= MIN_ENTROPY_BITS_PER_CHAR;
};

/* -------------------------------------------------------------------------- */
/* The rule table                                                              */
/* -------------------------------------------------------------------------- */

export const SECRET_RULES: readonly SecretRule[] = [
  {
    id: "private-key-block",
    /**
     * Two alternatives, complete block FIRST. JS alternation is leftmost-first,
     * so a terminated block wins; an unterminated `BEGIN … PRIVATE KEY` — the
     * normal case when a user selects half a file — still matches to end of
     * text. Without the second branch the most dangerous input in the feature
     * is the one that silently does not match.
     *
     * ` BLOCK` is optional because `gpg --export-secret-keys --armor` writes
     * `PRIVATE KEY BLOCK-----`, and nothing else in the table fires on armored
     * PGP: the body is base64 the entropy rule is off for by default and would
     * reject anyway on its 256-character ceiling.
     */
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*/g,
    span: "match",
    priority: 100,
  },
  {
    id: "url-credentials",
    /**
     * The span is the password only, so masking keeps the URL shape the model
     * needs (`postgres://user:[[…]]@host/db` still reads as a DSN). This is why
     * there is no separate DB-connection-string rule.
     *
     * The scheme is BOUNDED, and that bound is a latency guarantee rather than
     * a spelling rule: `.`, `-` and `+` are non-word characters, so `\b` offers
     * a fresh start at every one of them, and an unbounded class then expands
     * over the whole remaining run before `://` fails and backtracks one
     * character at a time. Ordinary dotted prose went quadratic — 114 000
     * characters of `a.b.c.d.e.` cost 3 512 ms of frozen main process, 2 ms
     * with the bound. No registered URI scheme comes close to 31 characters.
     *
     * THE PASSWORD ENDS AT THE LAST `@` OF THE AUTHORITY, WHICH IS WHAT
     * RFC 3986 SAYS AND NOT WHAT THE FIRST `@` SAYS. Excluding `@` from the
     * value class stopped at the FIRST one, so every DSN whose password carries
     * an `@` — the default symbol set of 1Password, Bitwarden and KeePass — was
     * cut: `mongodb+srv://admin:P@ss123@cluster0…` masked `P` and sent `ss123`
     * beside the placeholder under a "1 credential handled" label. 20.4 % of
     * 50 000 generated passwords on the password-manager default alphabet.
     *
     * So the value class admits `@` and greedy consumption plus
     * `(?=[^\s@]*(?:\s|$))` backtracks to the LAST `@` of the whitespace-
     * delimited run.
     *
     * The last `@` OF THE RUN, not the last one of the AUTHORITY as RFC 3986
     * would parse it, and the difference is another partial mask. A password
     * carrying both a `#` and an `@` — `KGTk02H@F$Q#f` — parses as authority
     * `user:KGTk02H@F$Q`, and every conforming parser then reports the password
     * as `KGTk02H`, because the input is not a valid URL in the first place:
     * userinfo may not hold a raw `#`. An RFC-exact rule masks that head and
     * sends `F$Q#f` beside the placeholder (75 of 5 000 generated passwords on
     * the password-manager default alphabet, 107 on KeePass). So the rule
     * refuses to choose an `@` that has another one behind it, and `/`, `?` and
     * `#` stay out of the value class: `postgres://user:pass@host/db?x=a@b` has
     * its last `@` past the authority, so it is a MISS rather than a cut.
     *
     * `[^\s@]*` rather than an unbounded run before the `@` test, so a rejected
     * candidate costs the distance to the NEXT `@` instead of the distance to
     * the end of the run — the difference between linear and quadratic on
     * `amqp://guest:` + `a@`×200 000.
     *
     * Faster than the first-`@` pattern despite the wider class: the lookahead
     * fails on one character at every wrong `@`, where the old one had to
     * re-enter the value class.
     */
    pattern:
      /(?<lead>\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]+:)(?<value>[^\s/?#]+)@(?=[^\s@]*(?:\s|$))/gi,
    span: "value",
    priority: 90,
    maskable: ({ text, start, groups }) =>
      !authorityReadingIsAmbiguous(text, start - (groups.lead ?? "").length),
  },
  {
    id: "authorization-header",
    pattern:
      /(?<lead>\bauthorization\s*:\s*(?:bearer|basic|token)\s+)(?<value>[A-Za-z0-9\-._~+/]{8,}={0,2})/gi,
    span: "value",
    priority: 85,
  },
  {
    id: "anthropic-key",
    pattern: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{24,}/g,
    span: "match",
    priority: 82,
  },
  {
    id: "openrouter-key",
    pattern: /\bsk-or-v1-[A-Za-z0-9]{32,}/g,
    span: "match",
    priority: 82,
  },
  {
    id: "openai-key",
    // The lookahead keeps the two more specific `sk-` vendors above out of this
    // rule instead of relying on the overlap merge to sort them out.
    pattern: /\bsk-(?!ant-|or-)[A-Za-z0-9_-]{20,}/g,
    span: "match",
    priority: 80,
  },
  {
    id: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z0-9]{16}\b/g,
    span: "match",
    priority: 80,
  },
  {
    id: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{22,244})\b/g,
    span: "match",
    priority: 80,
  },
  {
    id: "slack-token",
    pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g,
    span: "match",
    priority: 80,
  },
  {
    id: "google-api-key",
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    span: "match",
    priority: 80,
  },
  {
    id: "gitlab-token",
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g,
    span: "match",
    priority: 80,
  },
  {
    id: "stripe-secret-key",
    /**
     * `pk_live_`/`pk_test_` are EXCLUDED. Stripe publishable keys are designed
     * to ship in client-side JS; flagging one manufactures a false positive
     * that trains users to click *Send anyway*.
     */
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
    span: "match",
    priority: 80,
  },
  {
    id: "npm-token",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
    span: "match",
    priority: 80,
  },
  {
    id: "shopify-token",
    pattern: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g,
    span: "match",
    priority: 80,
  },
  {
    id: "digitalocean-token",
    pattern: /\bdo[opr]_v1_[a-f0-9]{64}\b/g,
    span: "match",
    priority: 80,
  },
  {
    id: "jwt",
    // TWO `eyJ` segments, not three dot-separated base64 runs — otherwise
    // version strings and file paths fire.
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g,
    span: "match",
    priority: 70,
  },
  {
    id: "credential-assignment",
    /**
     * The span is the VALUE only, so masking leaves `API_KEY=[[...]]` and the
     * line keeps its meaning for the model.
     *
     * The NAME is quotable too: JSON is the most common way a selected
     * credential is written, and `{"api_key": "..."}` used to be invisible here
     * while the identical unquoted line matched. Quoting the name cannot widen
     * what counts as a credential - that decision is made in `accept`.
     *
     * THE VALUE CLASS EXCLUDES ONLY `VALUE_STOP`, AND NOTHING MAY BE ADDED TO
     * IT. Three rounds of this rule ended a value on a character that turned
     * out to live inside real credentials - `&` in `Tr0ub4dor&Xyz=99`, `#` in
     * `Hunter2#Winter=99`, Katakana in `abc123パスワード456`, `;` in
     * `Passw0rd;More1234` - and each time the masker replaced the head, left
     * the tail in the outgoing text beside the placeholder, and reported
     * `matchCount: 1` with no warning.
     *
     * A character class can only truncate, so the class is no longer trusted to
     * say where the value ENDED. Where it stops is a candidate boundary;
     * `endsAtValueBoundary` decides whether that was the real end, and
     * everything else - a quoted value stopped by a space, a value stopped by
     * the maximum, prose in a space-less script, a template stub - REJECTS THE
     * WHOLE CANDIDATE. Being wrong then costs a miss, which is the same nothing
     * the user already gets for every shape the detector does not recognise,
     * rather than most of a credential under a green label.
     *
     * `(?<![A-Za-z0-9])` is the second half of the `monkey` defence. The scan
     * resumes INSIDE a rejected candidate (see `collectRuleMatches`), so
     * without it `monkey=business` is retried three characters in and offers
     * `key` - a name the second stage accepts. A separator or a quote may
     * precede the name (`_password=`, `"api_key":`); a letter or digit may not.
     *
     * `u` is what makes `\p{sc=...}` available to the value predicates, and it
     * also makes the quantifier count CODE POINTS, so the maximum can never
     * fall between the halves of a surrogate pair.
     */
    pattern: new RegExp(
      [
        "(?<lead>[\"'`]?(?<![A-Za-z0-9])",
        CREDENTIAL_NAME_GATE,
        "(?<name>[A-Za-z][A-Za-z0-9_.-]{0,63})[\"'`]?\\s*[:=]\\s*(?<quote>[\"'`]?))",
        `(?<value>[^\\s"'\`]{6,${MAX_CREDENTIAL_VALUE_LENGTH}})`,
      ].join(""),
      "gu",
    ),
    span: "value",
    priority: 60,
    /**
     * Ordered by cost, and the name gate is first for more than tidiness: it is
     * the check that keeps a document full of credential-shaped names linear,
     * because everything after it runs only once the value has been consumed.
     */
    accept: ({ value, text, start, groups }) =>
      isCredentialName(groups.name ?? "") &&
      endsAtValueBoundary(text, start, start + value.length, groups.quote ?? "") &&
      !SPACELESS_SCRIPT_CHARACTER.test(value) &&
      !isPlaceholderValue(value),
    maskable: ({ value, text, start, groups }) =>
      spanCoversCredential(text, start + value.length, groups.quote ?? ""),
    /**
     * The value class excludes quote characters unconditionally (see above), so
     * a credential that itself begins and ends with the character an assignment
     * used as its quote cannot be represented by that class at all. Growing the
     * span by exactly `quote.length` (0 or 1, never more) covers it either way —
     * see `spanWidening` for why this needs no test of the quote's role.
     */
    widen: ({ groups }) => spanWidening(groups.quote ?? ""),
  },
  {
    id: "high-entropy-string",
    /**
     * Maximal runs only: the trailing lookahead stops `{32,}` from carving a
     * 300-character run into an accepted 256 plus an accepted 44. Length is
     * then rejected in `accept`, so an over-long run yields nothing at all.
     */
    pattern: /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{32,}(?![A-Za-z0-9+/=_-])/g,
    span: "match",
    priority: 10,
    optIn: true,
    accept: acceptHighEntropyString,
  },
];
