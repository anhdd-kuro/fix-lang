/**
 * @file profileSwitch.ts
 * @description Electron global shortcut handler for profile switching
 */

import { globalShortcut, Notification } from "electron";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { switchToNextProfile } from "~/features/providers/store/apiStore";
import { notifyActiveProfileChanged } from "~/main/profileChange";
import { getMainWindow } from "~/main/webViewWindows/mainWindow";
import { buildProfileSwitchHotkeyNotification } from "./profileSwitchNotification";
import { checkShortcut, handleError, withHotkeyThrottle } from "./utils";
import { LocalizedError } from "../notifications/error";

/**
 * Register global shortcut to switch to the next profile
 */
export const registerProfileSwitchShortcut = (): void => {
  const keyBindings = keybindingStore.getKeyBindings();
  const accelerator = keyBindings.profileSwitch;

  if (!accelerator) {
    console.warn("No shortcut configured for profile switch");
    return;
  }

  const ret = globalShortcut.register(
    accelerator,
    withHotkeyThrottle(accelerator, async () => {
    console.log("Profile switch shortcut triggered");

    try {
      const nextProfile = switchToNextProfile();

      if (nextProfile) {
        globalShortcut.unregisterAll();
        const mainWindow = getMainWindow();
        if (mainWindow) {
          const { registerHotkeys } = await import("./index");
          registerHotkeys(mainWindow);
        }
        // This path never crosses preload, so no renderer would otherwise learn
        // that every profile-scoped credential just changed underneath it.
        notifyActiveProfileChanged();
        new Notification(
          buildProfileSwitchHotkeyNotification(nextProfile.name),
        ).show();
      } else {
        handleError(
          new LocalizedError(
            "No profiles available.",
            "notifications.error.noProfilesAvailable.body",
          ),
        );
      }
    } catch (error) {
      console.error("Error switching profile:", error);
      handleError(error);
    }
  }),
  );

  checkShortcut(ret);
};
