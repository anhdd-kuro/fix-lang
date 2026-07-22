import { showErrorNotification } from "~/main/notifications/error";

export const checkShortcut = (shortcut: boolean) => {
  if (!shortcut) {
    console.error(`Shortcut ${shortcut} is not set in settings.`);
    handleError(new Error(`Shortcut ${shortcut} is not set in settings.`));
    return false;
  }
  console.log(`Global shortcut ${shortcut} registered successfully.`);
  return true;
};

export const handleError = (error: unknown) => {
  console.error("Error during grammar fixing or IPC send:", error);
  showErrorNotification(error, "Failed to correct text. Please try again.");
};
