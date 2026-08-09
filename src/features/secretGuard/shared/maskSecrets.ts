/**
 * @file maskSecrets.ts
 * @description Swaps credentials for salted placeholders before a request and
 * puts them back afterwards — all of them or none of them.
 *
 * Pure and electron-free. The salt generator is injected the same way
 * `latencyTimer` injects `now`.
 */
import { isFullyMaskable, scanForSecrets, type SecretScanOptions } from "./detectSecrets";
import {
  buildSecretPlaceholder,
  SECRET_PLACEHOLDER_MARKER,
  type SecretRuleId,
} from "./secretRules";

export type SecretMasking = {
  /** What actually gets sent. */
  maskedText: string;
  /**
   * placeholder → the original value. Stays in main-process memory for the
   * length of one request: never logged, never persisted, never sent over IPC.
   */
  replacements: ReadonlyMap<string, string>;
  /** Distinct placeholders — identical values share one. */
  placeholderCount: number;
  /** Spans replaced, which is ≥ `placeholderCount`. */
  matchCount: number;
  /**
   * Whether every replaced span covered the WHOLE credential.
   *
   * `false` means at least one placeholder MAY have some of its own credential
   * still sitting beside it in `maskedText` — a value whose end the surrounding
   * text does not pin down, such as one that stopped at a space, at a quote or
   * at a comment marker. The masking is still performed, because the
   * alternative (dropping the span) sends the credential in the clear; what
   * must not happen is SENDING it while telling the user it was handled.
   *
   * A masking mode reads this BEFORE it sends and downgrades the request to a
   * confirm. That decision belongs to the gate, not here: this module is pure
   * and has no dialog, and a caller that has not been updated keeps exactly the
   * behaviour it had rather than silently losing every mask.
   */
  fullyMaskable: boolean;
  ruleIds: readonly SecretRuleId[];
  salt: string;
};

export type SecretRestoreFailure = "placeholder-missing" | "placeholder-residue";

export type SecretRestoreResult =
  | { ok: true; text: string }
  | { ok: false; reason: SecretRestoreFailure; missingCount: number };

export type MaskSecretsOptions = SecretScanOptions & {
  /**
   * Six ASCII characters. It only has to avoid colliding with the user's own
   * text and with an earlier request's placeholders, so it is not required to
   * be unpredictable.
   */
  salt?: () => string;
};

const defaultSalt = (): string =>
  Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .toUpperCase()
    .padStart(6, "0");

/**
 * Masks every detected credential in `text`.
 *
 * The placeholder is ASCII (survives any tokenizer and any locale), double
 * square bracketed (a placeholder idiom instruction-tuned models leave alone),
 * uppercase with underscores (so a grammar pass does not "correct" it),
 * zero-padded (so `_1` is never a prefix of `_10`) and salted (so it cannot
 * collide with the user's own text and a stale placeholder from an earlier
 * request can never match this one).
 */
export const maskSecrets = (text: string, options?: MaskSecretsOptions): SecretMasking => {
  const salt = (options?.salt ?? defaultSalt)();
  const scan = scanForSecrets(text, { highEntropyRule: options?.highEntropyRule });

  if (scan.matches.length === 0) {
    return {
      maskedText: text,
      replacements: new Map(),
      placeholderCount: 0,
      matchCount: 0,
      fullyMaskable: true,
      ruleIds: scan.ruleIds,
      salt,
    };
  }

  const placeholderByValue = new Map<string, string>();
  const replacements = new Map<string, string>();
  const pieces: string[] = [];
  let cursor = 0;

  for (const match of scan.matches) {
    const value = text.slice(match.start, match.end);
    const existing = placeholderByValue.get(value);
    const placeholder = existing ?? buildSecretPlaceholder(salt, placeholderByValue.size + 1);
    if (existing === undefined) {
      placeholderByValue.set(value, placeholder);
      replacements.set(placeholder, value);
    }
    pieces.push(text.slice(cursor, match.start), placeholder);
    cursor = match.end;
  }
  pieces.push(text.slice(cursor));

  return {
    maskedText: pieces.join(""),
    replacements,
    placeholderCount: replacements.size,
    matchCount: scan.matches.length,
    fullyMaskable: isFullyMaskable(scan),
    ruleIds: scan.ruleIds,
    salt,
  };
};

const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
};

/**
 * Puts the real values back, or refuses.
 *
 * Order matters:
 *
 * 1. Literal, CASE-SENSITIVE count per placeholder. A lowercased, spaced or
 *    re-bracketed placeholder counts as MISSING — the same refusal to be
 *    lenient `parseReply.ts` makes, and for the same reason: if the model
 *    rewrote the placeholder, there is no evidence it left anything else alone.
 * 2. Residue: the salted marker must not survive anywhere, which catches
 *    mangled placeholders that counting alone misses. Compared CASE-FOLDED,
 *    unlike step 1: a model that echoes one placeholder correctly and repeats
 *    it lowercased passes the count, and the lowercased copy would then be
 *    pasted into the user's document under an all-or-nothing "ok". No
 *    legitimate text contains `fixlang_secret_<salt>` in any casing.
 * 3. Replacement via `split(placeholder).join(value)`, NEVER
 *    `String.replaceAll` — the latter interprets `$&`, `$1` and `$'` in the
 *    REPLACEMENT, so a secret containing them would be silently corrupted and
 *    then pasted over the user's real selection in a third-party app.
 */
export const restoreSecrets = (reply: string, masking: SecretMasking): SecretRestoreResult => {
  if (masking.replacements.size === 0) {
    return { ok: true, text: reply };
  }

  const missingCount = [...masking.replacements.keys()].filter(
    (placeholder) => countOccurrences(reply, placeholder) === 0,
  ).length;
  if (missingCount > 0) {
    return { ok: false, reason: "placeholder-missing", missingCount };
  }

  const restored = [...masking.replacements.entries()].reduce(
    (text, [placeholder, value]) => text.split(placeholder).join(value),
    reply,
  );

  const residueMarker = `${SECRET_PLACEHOLDER_MARKER}${masking.salt}`.toLowerCase();
  if (restored.toLowerCase().includes(residueMarker)) {
    return { ok: false, reason: "placeholder-residue", missingCount: 0 };
  }

  return { ok: true, text: restored };
};
