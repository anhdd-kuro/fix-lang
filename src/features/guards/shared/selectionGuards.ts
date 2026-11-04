/**
 * @file selectionGuards.ts
 * @description The only place selection-guard policy lives: evaluates the
 * frontmost-app deny-list, then the selection size cap. Electron-free and
 * pure so the whole policy is testable without a running app.
 *
 * Deny beats size on purpose. The deny-list is the only verdict the user
 * cannot override — it is a rule they wrote about WHERE text may come from,
 * and there is nothing left to weigh once it matches — so it has to be asked
 * first: nobody should be asked to confirm sending text that was going to be
 * refused outright anyway.
 */
import { isBundleIdDenied, normalizeBundleId } from "./guardSettings";
import type { SelectionGuardSettings } from "./guardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";

export type SelectionGuardVerdict =
  | { kind: "allow" }
  | { kind: "confirm"; reason: "large-selection"; chars: number; limit: number }
  | { kind: "block"; reason: "denied-app"; bundleId: string };

export type SelectionGuardInput = {
  text: string;
  activeApp: ActiveApp | null;
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

const evaluateSizeCap = (
  text: string,
  limit: number,
): SelectionGuardVerdict => {
  if (limit <= 0) return ALLOW;
  return text.length > limit
    ? { kind: "confirm", reason: "large-selection", chars: text.length, limit }
    : ALLOW;
};

export type SelectionGuardConfirmVerdict = Extract<
  SelectionGuardVerdict,
  { kind: "confirm" }
>;

/**
 * The measurable half of a confirm verdict, ready to spread into a log line.
 *
 * Every key here is one `redactLogContext` leaves alone. The natural name —
 * `selectedTextLength` — is blanked to `"[REDACTED]"` by a
 * substring match on the key NAME, silently and with no error, which is how
 * `clipboardChanged` shipped as a dead metric once already. Shared rather than
 * written out at each call site so the next guard consumer cannot reinvent a
 * name that redacts.
 */
export const selectionGuardLogContext = (
  verdict: SelectionGuardConfirmVerdict,
) => ({
  textLength: verdict.chars,
  charLimit: verdict.limit,
});

export const evaluateSelectionGuards = (
  input: SelectionGuardInput,
): SelectionGuardVerdict => {
  const denyVerdict = evaluateDenyList(
    input.activeApp,
    input.settings.deniedBundleIds,
  );
  if (denyVerdict.kind !== "allow") return denyVerdict;

  return evaluateSizeCap(input.text, input.settings.maxSelectionChars);
};
