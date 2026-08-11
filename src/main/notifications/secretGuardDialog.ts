/**
 * @file secretGuardDialog.ts
 * @description Confirm-before-sending dialog for the secret guard. It names
 * the RULES that matched and never the values that matched them.
 *
 * That guarantee is structural, not a review-time promise:
 * {@link SecretConfirmDialogInput} carries no free text at all — a closed
 * union of rule ids and a count — so the call that would leak a credential
 * onto a screen cannot be written. Keep it that way; do not widen it to take
 * the matched text, an excerpt, or the selection.
 *
 * Uses only the awaited `dialog.showMessageBox` — the sync form previously
 * froze the main process behind stacked modals (see the comment beside
 * `promptAccessibilityPermission`'s call site in `~/main/index.ts`).
 */
import { dialog } from "electron";
import { mainT } from "~/main/i18n";
import type { SecretRuleId } from "~/features/secretGuard/shared/secretRules";

/** No `string` field, ever: see the file doc. */
export type SecretConfirmDialogInput = {
  ruleIds: readonly SecretRuleId[];
  matchCount: number;
};

const CANCEL_INDEX = 0;
const SEND_INDEX = 1;

/** Beyond this the list stops being readable and starts being a wall the user clicks past. */
const MAX_NAMED_RULES = 3;

const describeRules = (ruleIds: readonly SecretRuleId[]): string => {
  const named = ruleIds
    .slice(0, MAX_NAMED_RULES)
    .map((ruleId) => mainT(`security.rules.${ruleId}`));
  const omitted = ruleIds.length - named.length;
  const parts =
    omitted > 0
      ? [...named, mainT("notifications.secretGuard.confirm.andMore", { count: omitted })]
      : named;
  return parts.join(", ");
};

/**
 * Pure builder, so the leak guarantee is testable without Electron: a dialog
 * built from a scan of text full of real-shaped credentials JSON-stringifies
 * with none of them in it.
 *
 * No `checkboxLabel` — a "Don't ask again" control is a one-click permanent
 * disable of the only protection, offered on exactly the surface the user
 * most wants gone. Do not add one.
 */
export const buildSecretConfirmDialog = ({
  ruleIds,
  matchCount,
}: SecretConfirmDialogInput): Electron.MessageBoxOptions => ({
  type: "warning",
  buttons: [
    mainT("notifications.secretGuard.confirm.cancel"),
    mainT("notifications.secretGuard.confirm.send"),
  ],
  defaultId: CANCEL_INDEX,
  cancelId: CANCEL_INDEX,
  title: mainT("notifications.secretGuard.confirm.title"),
  message: mainT("notifications.secretGuard.confirm.title"),
  detail: mainT("notifications.secretGuard.confirm.detail", {
    count: matchCount,
    matchCount,
    ruleNames: describeRules(ruleIds),
  }),
});

/**
 * Not time-throttled — a suppressed dialog means a secret sent without
 * consent. One dialog at a time instead, and a reentrant call fails CLOSED:
 * an unanswered dialog must never become an implicit yes.
 */
let dialogInFlight = false;

/** Resolves `true` only when the user picked "Send anyway", asserted by index. */
export const confirmSecretSend = async (
  input: SecretConfirmDialogInput,
): Promise<boolean> => {
  // Outside the `try` on purpose: the `finally` clears `dialogInFlight`
  // unconditionally, so a reentrant call that returned from INSIDE the try
  // would clear the flag belonging to the dialog still on screen — and the
  // caller after that would stack a second modal on top of it.
  if (dialogInFlight) return false;

  dialogInFlight = true;
  try {
    const { response } = await dialog.showMessageBox(buildSecretConfirmDialog(input));
    return response === SEND_INDEX;
  } catch {
    // A dialog that failed to open was never answered, so it is not consent.
    return false;
  } finally {
    dialogInFlight = false;
  }
};
