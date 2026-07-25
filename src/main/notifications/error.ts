import { app, Notification } from "electron";
import { mainT } from "~/main/i18n";
import { showErrorPopup } from "~/main/webViewWindows/errorPopupWindow";

const notifiedErrors = new WeakSet<object>();
const pendingErrors = new WeakSet<object>();

/**
 * Shows a desktop notification for a user-visible main-process error.
 *
 * The same Error is commonly rethrown through the AI request, hotkey, and IPC
 * layers. Remembering object errors prevents those layers from notifying twice
 * for a single failed action without suppressing a later, separate failure.
 *
 * `fallbackMessage`'s default is read via `mainT()` at call time (not a
 * literal), so the body shown when `error` isn't an `Error` instance and no
 * caller-supplied fallback is passed stays locale-aware, matching the
 * notification `title` below.
 */
export const showErrorNotification = (
  error: unknown,
  fallbackMessage = mainT("notifications.error.body"),
): void => {
  const showFallback = (): void => {
    showErrorPopup(error instanceof Error ? error.message : fallbackMessage);
    if (error !== null && typeof error === "object") {
      notifiedErrors.add(error);
    }
  };

  if (error !== null && typeof error === "object") {
    if (notifiedErrors.has(error)) {
      return;
    }
  }

  if (!app.isReady()) {
    if (error !== null && typeof error === "object") {
      if (pendingErrors.has(error)) {
        return;
      }
      pendingErrors.add(error);
    }

    app.once("ready", () => {
      if (error !== null && typeof error === "object") {
        pendingErrors.delete(error);
      }
      showErrorNotification(error, fallbackMessage);
    });
    return;
  }

  try {
    if (Notification.isSupported?.() === false) {
      showFallback();
      return;
    }

    const notification = new Notification({
      title: mainT("notifications.error.title"),
      body: error instanceof Error ? error.message : fallbackMessage,
      urgency: "critical",
    });
    notification.on("failed", (_event, notificationError: string) => {
      console.error("Desktop notification failed:", notificationError);
      showFallback();
    });
    notification.show();

    if (error !== null && typeof error === "object") {
      notifiedErrors.add(error);
    }
  } catch {
    // Notification delivery must never mask the original application error.
    showFallback();
  }
};
