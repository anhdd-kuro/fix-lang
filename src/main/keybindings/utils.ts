import {
  AccessibilityPermissionError,
  LocalizedError,
  showErrorNotification,
} from "~/main/notifications/error";
import { promptAccessibilityPermission } from "~/utils";

/** Ignore a second press of the same accelerator inside this window. */
export const HOTKEY_THROTTLE_MS = 500;

const lastHotkeyInvokeAt = new Map<string, number>();

/**
 * Wraps a global-shortcut callback so a fast accidental double-press of the
 * same accelerator is ignored. Distinct accelerators do not block each other.
 * The first press inside the window always runs; later presses after the
 * window elapses run normally.
 */
export const withHotkeyThrottle = (
  accelerator: string,
  handler: () => void | Promise<void>,
  now: () => number = Date.now,
): (() => void | Promise<void>) => {
  return () => {
    const at = now();
    const last = lastHotkeyInvokeAt.get(accelerator) ?? 0;
    if (at - last < HOTKEY_THROTTLE_MS) {
      return;
    }
    lastHotkeyInvokeAt.set(accelerator, at);
    return handler();
  };
};

/** Clears throttle timestamps between tests. */
export const resetHotkeyThrottleForTests = (): void => {
  lastHotkeyInvokeAt.clear();
};

export const checkShortcut = (shortcut: boolean) => {
  if (!shortcut) {
    console.error(`Shortcut ${shortcut} is not set in settings.`);
    handleError(
      new LocalizedError(
        `Shortcut ${shortcut} is not set in settings.`,
        "notifications.error.hotkeyRegistrationFailed.body",
      ),
    );
    return false;
  }
  console.log(`Global shortcut ${shortcut} registered successfully.`);
  return true;
};

export const handleError = (error: unknown) => {
  console.error("Error during grammar fixing or IPC send:", error);
  // No explicit fallback: `showErrorNotification` reads a localized default
  // (`notifications.error.body`) via `mainT()` at call time. The previous
  // hardcoded English literal here ("Failed to correct text...") both broke
  // localization for non-Error values *and* was wrong for three of
  // `handleError`'s four call sites — it's shared by correction, PromptGen,
  // profile-switch, and hotkey-registration failures, not just correction.
  showErrorNotification(error);

  // A mid-session Accessibility revocation (e.g. after an unsigned-app
  // update changes the code identity) is otherwise only ever surfaced as a
  // desktop notification — easy to miss, and the log shows desktop
  // notifications can *also* fail in this exact state (`UNErrorDomain error
  // 1`). Also prompt the actionable dialog so the user has a real path to
  // fixing it. `promptAccessibilityPermission` throttles itself, so a burst
  // of repeated hotkey failures shows at most one dialog.
  if (error instanceof AccessibilityPermissionError) {
    void promptAccessibilityPermission();
  }
};
