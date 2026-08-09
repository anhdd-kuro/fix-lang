/**
 * @file selectionGuards.ts
 * @description The only place selection-guard policy lives: evaluates the
 * frontmost-app deny-list, the stale-clipboard age guard, and the selection
 * size cap, in that order. Electron-free and pure so the whole policy is
 * testable without a running app.
 *
 * Deny beats age beats size on purpose: size is the only overridable
 * verdict (`confirm`), so a user must never be asked to confirm sending text
 * that was going to be refused outright anyway.
 */
import { isBundleIdDenied, normalizeBundleId } from "./guardSettings";
import type { SelectionGuardSettings } from "./guardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";

export type SelectionGuardVerdict =
  | { kind: "allow" }
  | { kind: "confirm"; chars: number; limit: number }
  | { kind: "block"; reason: "stale-clipboard"; ageMs: number; limitMs: number }
  | { kind: "block"; reason: "denied-app"; bundleId: string };

export type SelectionGuardInput = {
  text: string;
  changed: boolean;
  activeApp: ActiveApp | null;
  /** `null` until a clipboard change has been observed; fails open. */
  ageMs: number | null;
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
 * `changed === true` always allows regardless of `ageMs`: a change means the
 * selection was just copied, so its age is zero by definition — this is the
 * regression guard for "copy → paste → reselect identical text → hotkey".
 * `ageMs === null` (unknown age, e.g. app just started) fails open. The
 * boundary is strict `>`: `ageMs === limitMs` still allows.
 */
const evaluateClipboardAge = (
  changed: boolean,
  ageMs: number | null,
  limitSeconds: number,
): SelectionGuardVerdict => {
  if (limitSeconds <= 0) return ALLOW;
  if (changed) return ALLOW;
  if (ageMs === null) return ALLOW;

  const limitMs = limitSeconds * 1_000;
  return ageMs > limitMs ? { kind: "block", reason: "stale-clipboard", ageMs, limitMs } : ALLOW;
};

const evaluateSizeCap = (text: string, limit: number): SelectionGuardVerdict => {
  if (limit <= 0) return ALLOW;
  return text.length > limit ? { kind: "confirm", chars: text.length, limit } : ALLOW;
};

export const evaluateSelectionGuards = (input: SelectionGuardInput): SelectionGuardVerdict => {
  const denyVerdict = evaluateDenyList(input.activeApp, input.settings.deniedBundleIds);
  if (denyVerdict.kind !== "allow") return denyVerdict;

  const ageVerdict = evaluateClipboardAge(
    input.changed,
    input.ageMs,
    input.settings.clipboardMaxAgeSeconds,
  );
  if (ageVerdict.kind !== "allow") return ageVerdict;

  return evaluateSizeCap(input.text, input.settings.maxSelectionChars);
};
