/**
 * @file confirmLargeSelection.ts
 * @description Confirm-before-send dialog for the selection-size guard. Uses
 * only the awaited `dialog.showMessageBox` — the sync form previously froze
 * the main process behind stacked modals on repeated hotkey presses (see the
 * comment next to `promptAccessibilityPermission`'s call site in
 * `~/main/index.ts`), and that failure mode is exactly what this dialog would
 * risk on a mis-selected large document if it were allowed to stack.
 */
import { dialog } from "electron";
import { mainT } from "~/main/i18n";

const CANCEL_INDEX = 0;
const SEND_INDEX = 1;

/**
 * Not time-throttled like the accessibility prompt: instead this module-level
 * promise means a second press while a dialog is already open resolves
 * `false` rather than opening a second modal. An unanswered dialog must never
 * become an implicit yes, so failing closed here — rather than queuing or
 * replacing it — is the point.
 */
let pending: Promise<boolean> | null = null;

const showDialog = async (chars: number, limit: number): Promise<boolean> => {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: [
      mainT("notifications.confirm.largeSelection.cancel"),
      mainT("notifications.confirm.largeSelection.send"),
    ],
    defaultId: CANCEL_INDEX,
    cancelId: CANCEL_INDEX,
    title: mainT("notifications.confirm.largeSelection.title"),
    message: mainT("notifications.confirm.largeSelection.message", { chars }),
    detail: mainT("notifications.confirm.largeSelection.detail", { limit }),
  });

  return response === SEND_INDEX;
};

/** Resolves `true` only when the user picked "Send anyway". */
export const confirmLargeSelection = async (chars: number, limit: number): Promise<boolean> => {
  if (pending) return false;

  pending = showDialog(chars, limit);
  try {
    return await pending;
  } finally {
    pending = null;
  }
};
