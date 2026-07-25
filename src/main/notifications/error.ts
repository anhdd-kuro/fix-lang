import { app, Notification } from "electron";
import { mainT } from "~/main/i18n";
import { showErrorPopup } from "~/main/webViewWindows/errorPopupWindow";
import type { TKey, TranslateParams } from "~/shared/i18n/translate";

const notifiedErrors = new WeakSet<object>();
const pendingErrors = new WeakSet<object>();

/**
 * An `Error` manufactured purely to signal a control-flow condition (no text
 * selected, no profiles available, a hotkey failed to register, …) rather
 * than caught from a real failure. Plain `new Error("...")`'s `.message` is
 * assumed by {@link showErrorNotification} to already be safe, locale-agnostic
 * user copy (e.g. bubbled up from a provider request) and is shown verbatim
 * as the notification body — which is correct for a genuinely caught error,
 * but wrong for a string a call site invented purely to name a condition:
 * that string is developer diagnostic English, not translated copy, yet it
 * would silently override the localized title's language.
 *
 * Use `LocalizedError` at those call sites instead: pass the English
 * diagnostic as `devMessage` (kept on `.message` for `console.error`/the
 * structured logger, same as any other `Error`), and a catalog key as
 * `messageKey` — `showErrorNotification` resolves that key via `mainT()` at
 * display time for the notification body, so it tracks the active locale
 * like every other user-facing string.
 */
export class LocalizedError extends Error {
  readonly messageKey: TKey;
  readonly messageParams?: TranslateParams;

  constructor(devMessage: string, messageKey: TKey, messageParams?: TranslateParams) {
    super(devMessage);
    this.name = "LocalizedError";
    this.messageKey = messageKey;
    this.messageParams = messageParams;
  }
}

/**
 * Thrown by `getHighlightedText`/`pasteText` (`~/utils`) when macOS's
 * Accessibility permission has been revoked — e.g. after an unsigned-app
 * update changes the app's code identity — so keystroke synthesis via
 * `osascript` fails with "not allowed to send keystrokes. (1002)" (detected
 * by `isKeystrokePermissionDenied` in `~/main/accessibility/keystrokePermission`).
 *
 * A plain `LocalizedError` would already localize the notification body
 * correctly, but this dedicated subclass lets `handleError`
 * (`~/main/keybindings/utils.ts`) recognize the failure via `instanceof` and
 * additionally trigger the actionable `promptAccessibilityPermission()`
 * dialog. That distinction matters because permission is normally only
 * checked once, at startup (`src/main/index.ts`) — without it, a mid-session
 * revocation is never surfaced beyond a notification the user can't act on.
 */
export class AccessibilityPermissionError extends LocalizedError {
  constructor(
    devMessage = "macOS Accessibility permission was revoked; osascript can no longer send keystrokes.",
  ) {
    super(devMessage, "notifications.error.accessibilityDenied.body");
    this.name = "AccessibilityPermissionError";
  }
}

/**
 * Resolves the user-facing notification body for `error`: the catalog
 * translation for a {@link LocalizedError}, `error.message` verbatim for any
 * other `Error` (assumed already safe, locale-agnostic user copy), or
 * `fallbackMessage` for a non-`Error` value.
 */
const resolveNotificationBody = (
  error: unknown,
  fallbackMessage: string,
): string => {
  if (error instanceof LocalizedError) {
    return mainT(error.messageKey, error.messageParams);
  }
  return error instanceof Error ? error.message : fallbackMessage;
};

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
    showErrorPopup(resolveNotificationBody(error, fallbackMessage));
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
      body: resolveNotificationBody(error, fallbackMessage),
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
