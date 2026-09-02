/**
 * @file detectSecrets.ts
 * @description Finds credential shapes in outgoing text and reports WHERE they
 * are — never WHAT they are.
 *
 * Pure and electron-free.
 */
import {
  SECRET_PLACEHOLDER_MARKER,
  SECRET_RULES,
  type SecretRule,
  type SecretRuleId,
} from "./secretRules";

/**
 * A located credential.
 *
 * There is no field carrying the matched text, and there must never be one:
 * that absence is the STRUCTURAL guarantee that a credential cannot reach a
 * log line, a dialog or an IPC payload — not a promise someone has to remember
 * at review time. `detectSecrets.test.ts` asserts the key set.
 */
export type SecretMatch = {
  ruleId: SecretRuleId;
  start: number;
  end: number;
  length: number;
  /**
   * Whether replacing this span leaves none of the credential behind — under
   * EVERY reading the surrounding text allows, not under the one the rule
   * happened to pick.
   *
   * `false` whenever a second reading would put more of the credential outside
   * the span, which is most of the time for `credential-assignment`:
   * `password=Correct Horse Battery` may or may not end at its space, and
   * `PASSWORD="hunter2Abc" # rotate` may or may not end at its quote. Rejecting
   * those loses 39 % of real credential lines; masking them sends part of a
   * credential beside a placeholder and reports success, which is a leak AND a
   * false assurance.
   *
   * So the match is reported and the caller is told it cannot be masked
   * cleanly — see {@link isFullyMaskable}. A BOOLEAN, deliberately: the field
   * that explains a partial mask is exactly where the no-matched-text guarantee
   * would be tempting to break, and it must never carry the uncovered tail.
   */
  maskable: boolean;
};

export type SecretScanResult = {
  matches: readonly SecretMatch[];
  /**
   * Derived from the RAW pre-merge matches, so a Slack token absorbed into a
   * private-key span is still named to the user in the confirm dialog.
   */
  ruleIds: readonly SecretRuleId[];
};

export type SecretScanOptions = { highEntropyRule?: boolean };

const EMPTY_RESULT: SecretScanResult = { matches: [], ruleIds: [] };

/** Fresh regex per scan: a shared `lastIndex` would make results order-dependent. */
const clonePattern = (pattern: RegExp): RegExp => new RegExp(pattern.source, pattern.flags);

const collectRuleMatches = (rule: SecretRule, text: string): SecretMatch[] => {
  const pattern = clonePattern(rule.pattern);
  const found: SecretMatch[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      match = pattern.exec(text);
      continue;
    }
    const groups = match.groups ?? {};
    const value = rule.span === "value" ? (groups.value ?? "") : match[0];
    const start = rule.span === "value" ? match.index + (groups.lead ?? "").length : match.index;
    const accepted =
      value.length > 0 &&
      // Text that already went through the masker is not a credential. Without
      // this, re-scanning a masked selection re-flags every placeholder — the
      // password slot of a masked DSN still looks exactly like a password.
      !value.includes(SECRET_PLACEHOLDER_MARKER) &&
      (rule.accept?.({ value, text, start, groups }) ?? true);
    if (accepted) {
      const context = { value, text, start, groups };
      const grown = rule.widen?.(context) ?? { before: 0, after: 0 };
      const spanStart = start - grown.before;
      const spanEnd = start + value.length + grown.after;
      found.push({
        ruleId: rule.id,
        start: spanStart,
        end: spanEnd,
        length: spanEnd - spanStart,
        maskable: rule.maskable?.(context) ?? true,
      });
    } else {
      // A rejected candidate is not a cleared region: `x=1&api_key=…` matches
      // as ONE candidate whose name `x` fails, and letting `lastIndex` stand
      // would skip the real key inside it. Resume one character past the
      // candidate's START, which still advances (the zero-length case is
      // handled above), so the scan cannot loop.
      pattern.lastIndex = match.index + 1;
    }
    match = pattern.exec(text);
  }
  return found;
};

type RuleRank = { index: number; priority: number };

const RULE_RANK = new Map<SecretRuleId, RuleRank>(
  SECRET_RULES.map((rule, index) => [rule.id, { index, priority: rule.priority }]),
);

/**
 * An id absent from the table sorts LAST at the LOWEST priority, so an
 * unrecognized rule can only ever lose a tie — never inherit the top rule's
 * standing and displace a real one.
 */
const UNKNOWN_RULE_RANK: RuleRank = { index: SECRET_RULES.length, priority: 0 };

const rankOf = (ruleId: SecretRuleId): RuleRank => RULE_RANK.get(ruleId) ?? UNKNOWN_RULE_RANK;

const compareMatches = (left: SecretMatch, right: SecretMatch): number =>
  left.start - right.start ||
  rankOf(right.ruleId).priority - rankOf(left.ruleId).priority ||
  right.length - left.length ||
  rankOf(left.ruleId).index - rankOf(right.ruleId).index;

/**
 * Contained spans are DROPPED; partially overlapping spans EXTEND the kept
 * span's `end` (union).
 *
 * Truncation is the one operation that can leave half a live credential in the
 * outgoing text, so it is never performed here — when in doubt the kept span
 * grows.
 *
 * `maskable` is ANDed across everything that overlaps, dropped spans included.
 * A merged span inherits the doubt of every span it swallowed: being wrong that
 * way costs a confirm dialog, being wrong the other way is a partial mask.
 */
const mergeOverlaps = (sorted: readonly SecretMatch[]): SecretMatch[] =>
  sorted.reduce<SecretMatch[]>((kept, candidate) => {
    const last = kept[kept.length - 1];
    if (last === undefined || candidate.start >= last.end) {
      return [...kept, candidate];
    }
    const maskable = last.maskable && candidate.maskable;
    if (candidate.end <= last.end) {
      return maskable === last.maskable ? kept : [...kept.slice(0, -1), { ...last, maskable }];
    }
    const extended: SecretMatch = {
      ...last,
      end: candidate.end,
      length: candidate.end - last.start,
      maskable,
    };
    return [...kept.slice(0, -1), extended];
  }, []);

const uniqueRuleIds = (matches: readonly SecretMatch[]): SecretRuleId[] => [
  ...new Set(matches.map((match) => match.ruleId)),
];

/**
 * Whether every match in a scan can be replaced without leaving part of a
 * credential in the outgoing text.
 *
 * The ONE question a masking mode has to ask before it masks: a `false` here
 * means the request must be downgraded to a confirm rather than half-masked
 * under a green label. Exported so that decision lives in one place instead of
 * being re-derived per send site.
 */
export const isFullyMaskable = (result: SecretScanResult): boolean =>
  result.matches.every((match) => match.maskable);

/**
 * Scans `text` for credential shapes.
 *
 * The opt-in high-entropy rule is off unless `highEntropyRule` is `true`: it is
 * the only rule with a real false-positive rate, and a false positive is what
 * trains a user to click through the dialog that matters.
 */
export const scanForSecrets = (text: string, options?: SecretScanOptions): SecretScanResult => {
  if (text.length === 0) return EMPTY_RESULT;

  const activeRules = SECRET_RULES.filter(
    (rule) => rule.optIn !== true || options?.highEntropyRule === true,
  );
  const raw = activeRules.flatMap((rule) => collectRuleMatches(rule, text));
  if (raw.length === 0) return EMPTY_RESULT;

  const sorted = [...raw].sort(compareMatches);
  return { matches: mergeOverlaps(sorted), ruleIds: uniqueRuleIds(sorted) };
};
