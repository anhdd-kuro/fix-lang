/**
 * @file confirmSelectionGuard.ts
 * @description Confirm-before-send dialog for every overridable selection
 * guard: an oversized selection, a clipboard older than the configured limit,
 * and a clipboard whose age cannot be established at all.
 *
 * Uses only the awaited `dialog.showMessageBox` — the sync form previously
 * froze the main process behind stacked modals on repeated hotkey presses (see
 * the comment next to `promptAccessibilityPermission`'s call site in
 * `~/main/index.ts`), and that failure mode is exactly what this dialog would
 * risk on a mis-selected large document if it were allowed to stack.
 *
 * ONE module, one `pending`, for all three reasons: the guards can fire on the
 * same press, and two dialogs stacked over a single hotkey is how a consent
 * surface becomes something people dismiss without reading.
 */
import { dialog } from "electron";
import { mainT } from "~/main/i18n";
import type { SelectionGuardVerdict } from "~/features/guards/shared/selectionGuards";
import type { TKey } from "~/features/i18n/shared/translate";

const CANCEL_INDEX = 0;
const SEND_INDEX = 1;

type ConfirmVerdict = Extract<SelectionGuardVerdict, { kind: "confirm" }>;

/**
 * Not time-throttled like the accessibility prompt: instead this module-level
 * promise means a second press while a dialog is already open resolves
 * `false` rather than opening a second modal. An unanswered dialog must never
 * become an implicit yes, so failing closed here — rather than queuing or
 * replacing it — is the point.
 */
let pending: Promise<boolean> | null = null;

type DialogCopy = {
  titleKey: TKey;
  message: string;
  detail: string;
};

/**
 * The age dialogs say the two different things they actually know. "This has
 * been on the clipboard for 12 minutes" is a measurement; "this was already
 * there when FixLang started, so it may be far older than it looks" is the
 * absence of one, and a user deciding whether to send a password needs to be
 * told which of those they are looking at.
 */
const resolveCopy = (verdict: ConfirmVerdict): DialogCopy => {
  if (verdict.reason === "large-selection") {
    return {
      titleKey: "notifications.confirm.largeSelection.title",
      message: mainT("notifications.confirm.largeSelection.message", { chars: verdict.chars }),
      detail: mainT("notifications.confirm.largeSelection.detail", { limit: verdict.limit }),
    };
  }

  if (verdict.reason === "stale-clipboard") {
    return {
      titleKey: "notifications.confirm.staleClipboard.title",
      message: mainT("notifications.confirm.staleClipboard.message", {
        seconds: Math.round(verdict.ageMs / 1000),
      }),
      detail: mainT("notifications.confirm.staleClipboard.detail", {
        seconds: Math.round(verdict.limitMs / 1000),
      }),
    };
  }

  return {
    titleKey: "notifications.confirm.unknownClipboardAge.title",
    message: mainT("notifications.confirm.unknownClipboardAge.message"),
    detail: mainT("notifications.confirm.unknownClipboardAge.detail"),
  };
};

const showDialog = async (verdict: ConfirmVerdict): Promise<boolean> => {
  const copy = resolveCopy(verdict);
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: [
      mainT("notifications.confirm.selectionGuard.cancel"),
      mainT("notifications.confirm.selectionGuard.send"),
    ],
    defaultId: CANCEL_INDEX,
    cancelId: CANCEL_INDEX,
    title: mainT(copy.titleKey),
    message: copy.message,
    detail: copy.detail,
  });

  return response === SEND_INDEX;
};

/** Resolves `true` only when the user picked "Send anyway". */
export const confirmSelectionGuard = async (verdict: ConfirmVerdict): Promise<boolean> => {
  if (pending) return false;

  pending = showDialog(verdict);
  try {
    return await pending;
  } finally {
    pending = null;
  }
};
