/**
 * @file profileSwitch.ts
 * @description Electron global shortcut handler for profile switching
 */

import { globalShortcut, Notification } from "electron";
import { getMainWindow } from "~/main/webViewWindows/mainWindow";
import { switchToNextProfile } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { checkShortcut, handleError } from "./utils";

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

  const ret = globalShortcut.register(accelerator, async () => {
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
        new Notification({
          title: "Profile Switched",
          body: `Switched to profile: ${nextProfile.name}`,
        }).show();
      } else {
        handleError(new Error("No profiles available."));
      }
    } catch (error) {
      console.error("Error switching profile:", error);
      handleError(error);
    }
  });

  checkShortcut(ret);
};
