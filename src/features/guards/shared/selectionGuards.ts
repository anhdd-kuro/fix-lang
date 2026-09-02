/**
 * @file selectionGuards.ts
 * @description The only place selection-guard policy lives: evaluates the
 * frontmost-app deny-list, the stale-clipboard age guard, and the selection
 * size cap, in that order. Electron-free and pure so the whole policy is
 * testable without a running app.
 *
 * Deny beats age beats size on purpose. The deny-list is the only verdict the
 * user cannot override — it is a rule they wrote about WHERE text may come
 * from, and there is nothing left to weigh once it matches — so it has to be
 * asked first: nobody should be asked to confirm sending text that was going
 * to be refused outright anyway. Age then beats size because being asked
 * about the size of something you never meant to send answers the wrong
 * question.
 *
 * Only ONE confirm is ever raised per selection, so a selection that is both
 * old and huge asks about its age. The dialogs are a consent surface, and a
 * user clicking through two of them for one press learns to click through
 * them everywhere.
 */
import { isBundleIdDenied, normalizeBundleId } from "./guardSettings";
import type { SelectionGuardSettings } from "./guardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";
import type { ClipboardAge } from "~/main/clipboard/clipboardObserver";

export type SelectionGuardVerdict =
  | { kind: "allow" }
  | { kind: "confirm"; reason: "large-selection"; chars: number; limit: number }
  | { kind: "confirm"; reason: "stale-clipboard"; ageMs: number; limitMs: number }
  | { kind: "confirm"; reason: "unknown-clipboard-age"; ageMs: number; limitMs: number }
  | { kind: "block"; reason: "denied-app"; bundleId: string };

export type SelectionGuardInput = {
  text: string;
  changed: boolean;
  activeApp: ActiveApp | null;
  /** `null` until anything at all has been observed; fails open. */
  age: ClipboardAge | null;
  settings: SelectionGuardSettings;
};

const ALLOW: SelectionGuardVerdict = { kind: "allow" };

/**
 * `activeApp === null` covers FixLang itself and an unreadable frontmost
 * read — both best-effort by design, so this skips rather than blocks.
 * `bundleId === null` is a real app that reports no bundle id (unbundled
 * helper); it cannot be matched against the deny-list, so it also skips.
 */
const evaluateDenyList = (
  activeApp: ActiveApp | null,
  deniedBundleIds: readonly string[],
): SelectionGuardVerdict => {
  if (activeApp === null || activeApp.bundleId === null) return ALLOW;

  const bundleId = normalizeBundleId(activeApp.bundleId);
  if (bundleId === null) return ALLOW;

  return isBundleIdDenied(bundleId, deniedBundleIds)
    ? { kind: "block", reason: "denied-app", bundleId }
    : ALLOW;
};

/**
 * `changed === true` always allows regardless of age: a change means the
 * selection was just copied, so its age is zero by definition — this is the
 * regression guard for "copy → paste → reselect identical text → hotkey".
 * `age === null` (nothing observed at all) fails open. The boundary is strict
 * `>`: `ms === limitMs` still allows.
 *
 * A `"baseline"` origin confirms whatever the number says. The elapsed time
 * since a first sighting is a lower bound, not an age, so it starts at zero
 * for text that has been sitting there since before FixLang launched — the
 * precise value the guard exists to catch, waved through for one whole limit
 * window after every start.
 *
 * Both verdicts are CONFIRM rather than BLOCK, and that is load-bearing
 * rather than lenient. The observer folds an identical re-copy into "no
 * change" (same hash), and Electron exposes no pasteboard change counter to
 * tell it apart, so a user who deliberately copies the same text again on
 * hardware where the synthesized Cmd-C never lands cannot clear a block by
 * doing the one thing that ought to clear it — they would have to copy
 * something else first. A dialog naming the age keeps every accidental send
 * in front of the user while leaving that dead end open.
 */
const evaluateClipboardAge = (
  changed: boolean,
  age: ClipboardAge | null,
  limitSeconds: number,
): SelectionGuardVerdict => {
  if (limitSeconds <= 0) return ALLOW;
  if (changed) return ALLOW;
  if (age === null) return ALLOW;

  const limitMs = limitSeconds * 1_000;
  if (age.origin === "baseline") {
    return { kind: "confirm", reason: "unknown-clipboard-age", ageMs: age.ms, limitMs };
  }
  return age.ms > limitMs
    ? { kind: "confirm", reason: "stale-clipboard", ageMs: age.ms, limitMs }
    : ALLOW;
};

const evaluateSizeCap = (text: string, limit: number): SelectionGuardVerdict => {
  if (limit <= 0) return ALLOW;
  return text.length > limit
    ? { kind: "confirm", reason: "large-selection", chars: text.length, limit }
    : ALLOW;
};

export type SelectionGuardConfirmVerdict = Extract<SelectionGuardVerdict, { kind: "confirm" }>;

/**
 * The measurable half of a confirm verdict, ready to spread into a log line.
 *
 * Every key here is one `redactLogContext` leaves alone. The natural names —
 * `clipboardAgeMs`, `selectedTextLength` — are blanked to `"[REDACTED]"` by a
 * substring match on the key NAME, silently and with no error, which is how
 * `clipboardChanged` shipped as a dead metric once already. Shared rather than
 * written out at each call site so the next guard consumer cannot reinvent a
 * name that redacts.
 */
export const selectionGuardLogContext = (
  verdict: SelectionGuardConfirmVerdict,
): Record<string, number> =>
  verdict.reason === "large-selection"
    ? { textLength: verdict.chars, charLimit: verdict.limit }
    : { selectionAgeMs: verdict.ageMs, ageLimitMs: verdict.limitMs };

export const evaluateSelectionGuards = (input: SelectionGuardInput): SelectionGuardVerdict => {
  const denyVerdict = evaluateDenyList(input.activeApp, input.settings.deniedBundleIds);
  if (denyVerdict.kind !== "allow") return denyVerdict;

  const ageVerdict = evaluateClipboardAge(
    input.changed,
    input.age,
    input.settings.clipboardMaxAgeSeconds,
  );
  if (ageVerdict.kind !== "allow") return ageVerdict;

  return evaluateSizeCap(input.text, input.settings.maxSelectionChars);
};
