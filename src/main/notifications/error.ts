import {
  app,
  Notification,
  type NotificationConstructorOptions,
} from "electron";
import { z } from "zod";
import { mainT } from "~/main/i18n";
import { showErrorPopup } from "~/main/webViewWindows/errorPopupWindow";
import type { TKey, TranslateParams } from "~/features/i18n/shared/translate";

const notifiedErrors = new WeakSet<object>();
const pendingErrors = new WeakSet<object>();

/**
 * One link of a thrown value's `cause` chain: any non-null, non-function
 * object, read through inherited properties (`Error#name` lives on the
 * prototype).
 */
const ErrorChainLinkSchema = z.object({
  name: z.unknown().optional(),
  cause: z.unknown().optional(),
});

/**
 * Thrown values the dedupe sets can hold: non-null objects and arrays, never
 * primitives or functions.
 */
const TrackableErrorSchema = z.union([z.object({}), z.array(z.unknown())]);

const isTrackableError = (cause: unknown): cause is object =>
  TrackableErrorSchema.safeParse(cause).success;

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

  constructor(
    devMessage: string,
    messageKey: TKey,
    messageParams?: TranslateParams,
  ) {
    super(devMessage);
    this.name = "LocalizedError";
    this.messageKey = messageKey;
    this.messageParams = messageParams;
  }
}

/**
 * Thrown by `getHighlightedText`/`pasteText` (`~/utils`) when macOS's
 * Accessibility permission has been revoked — e.g. after an update changes the
 * app's code identity (each ad-hoc signed release has a new one) — so keystroke synthesis via
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
 * Notifies for a failed AI request unless the request asked to stay quiet.
 *
 * Every provider module notifies from its `catch` and from its
 * credentials-missing path. Those are correct for a request the user started
 * deliberately, and wrong for one started by typing: see `quiet` on
 * `AIRequestOptions`. Routing all of them through one helper keeps the
 * suppression rule in a single place instead of eleven inverted conditionals.
 */
export const notifyRequestError = (
  options: { quiet?: boolean },
  cause: unknown,
  fallbackMessage?: string,
): void => {
  if (options.quiet) {
    return;
  }
  if (fallbackMessage === undefined) {
    showErrorNotification(cause);
    return;
  }
  showErrorNotification(cause, fallbackMessage);
};

/**
 * True when `cause` is (or wraps) a cancellation rather than a failure.
 *
 * A caller that aborts its own request already knows the outcome, so telling
 * the user about it is noise at best. It is a correctness issue for any caller
 * that aborts routinely: autocomplete supersedes the in-flight request on every
 * keystroke, and each abort rejects through a provider `catch` that notifies —
 * one native macOS notification per character typed.
 *
 * Suppressing here rather than at the eleven notify sites keeps a single rule:
 * `fetch` rejects with `AbortError`, `AbortSignal.timeout` with `TimeoutError`,
 * and the AI SDK re-wraps both, so the `cause` chain is walked rather than only
 * the outermost error inspected.
 */
export const isAbortError = (cause: unknown): boolean => {
  const seen = new Set<unknown>();
  let current = cause;
  while (!seen.has(current)) {
    // The schema only takes plain objects; a thrown array is read through
    // its own properties.
    const link = ErrorChainLinkSchema.safeParse(
      Array.isArray(current) ? { ...current } : current,
    );
    if (!link.success) return false;
    seen.add(current);
    if (link.data.name === "AbortError" || link.data.name === "TimeoutError") {
      return true;
    }
    current = link.data.cause;
  }
  return false;
};

/**
 * Resolves the user-facing notification body for `cause`: the catalog
 * translation for a {@link LocalizedError}, `error.message` verbatim for any
 * other `Error` (assumed already safe, locale-agnostic user copy), or
 * `fallbackMessage` for a non-`Error` value.
 */
const resolveNotificationBody = (
  cause: unknown,
  fallbackMessage: string,
): string => {
  if (cause instanceof LocalizedError) {
    return mainT(cause.messageKey, cause.messageParams);
  }
  return cause instanceof Error ? cause.message : fallbackMessage;
};

/**
 * Shows a desktop notification, falling back to the in-app error popup when
 * the platform cannot deliver one.
 *
 * FixLang is not Developer ID signed, and macOS has refused notifications from
 * its bundle with `Application is not code signed` — delivered asynchronously on
 * the `failed` event, not as a throw, so a bare `new Notification(...).show()`
 * reports success and shows the user nothing. Any warning that is the only
 * explanation for something the app just did differently must come through
 * here rather than construct its own `Notification`.
 */
export const showNotificationWithFallback = (options: {
  title: string;
  body: string;
  urgency?: "normal" | "critical";
}): void => {
  const showFallback = (): void => {
    showErrorPopup(options.body);
  };

  try {
    if (Notification.isSupported?.() === false) {
      showFallback();
      return;
    }

    const notificationOptions: NotificationConstructorOptions = {
      title: options.title,
      body: options.body,
    };
    if (options.urgency !== undefined) {
      notificationOptions.urgency = options.urgency;
    }
    const notification = new Notification(notificationOptions);
    notification.on("failed", (_event, notificationError: string) => {
      console.error("Desktop notification failed:", notificationError);
      showFallback();
    });
    notification.show();
  } catch {
    showFallback();
  }
};

/**
 * Shows a desktop notification for a user-visible main-process error.
 *
 * The same Error is commonly rethrown through the AI request, hotkey, and IPC
 * layers. Remembering object errors prevents those layers from notifying twice
 * for a single failed action without suppressing a later, separate failure.
 *
 * `fallbackMessage`'s default is read via `mainT()` at call time (not a
 * literal), so the body shown when `cause` isn't an `Error` instance and no
 * caller-supplied fallback is passed stays locale-aware, matching the
 * notification `title` below.
 */
export const showErrorNotification = (
  cause: unknown,
  fallbackMessage = mainT("notifications.error.body"),
): void => {
  if (isAbortError(cause)) {
    return;
  }

  const showFallback = (): void => {
    showErrorPopup(resolveNotificationBody(cause, fallbackMessage));
    if (isTrackableError(cause)) {
      notifiedErrors.add(cause);
    }
  };

  if (isTrackableError(cause)) {
    if (notifiedErrors.has(cause)) {
      return;
    }
  }

  if (!app.isReady()) {
    if (isTrackableError(cause)) {
      if (pendingErrors.has(cause)) {
        return;
      }
      pendingErrors.add(cause);
    }

    app.once("ready", () => {
      if (isTrackableError(cause)) {
        pendingErrors.delete(cause);
      }
      showErrorNotification(cause, fallbackMessage);
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
      body: resolveNotificationBody(cause, fallbackMessage),
      urgency: "critical",
    });
    notification.on("failed", (_event, notificationError: string) => {
      console.error("Desktop notification failed:", notificationError);
      showFallback();
    });
    notification.show();

    if (isTrackableError(cause)) {
      notifiedErrors.add(cause);
    }
  } catch {
    // Notification delivery must never mask the original application error.
    showFallback();
  }
};
