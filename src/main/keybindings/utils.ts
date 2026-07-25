import {
  AccessibilityPermissionError,
  LocalizedError,
  showErrorNotification,
} from "~/main/notifications/error";
import { promptAccessibilityPermission } from "~/utils";

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
