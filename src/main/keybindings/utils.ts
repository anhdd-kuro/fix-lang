import { LocalizedError, showErrorNotification } from "~/main/notifications/error";

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
};
