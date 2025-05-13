/**
 * @file profileSwitch.ts
 * @description Electron global shortcut handler for profile switching
 */

import { globalShortcut, Notification } from "electron";
import { switchToNextProfile } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { checkShortcut } from "./utils";

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
        new Notification({
          title: "Profile Switched",
          body: `Switched to profile: ${nextProfile.name}`,
        }).show();
      } else {
        new Notification({
          title: "Profile Switch Failed",
          body: "No profiles available",
        }).show();
      }
    } catch (error) {
      console.error("Error switching profile:", error);
      new Notification({
        title: "Profile Switch Error",
        body: error instanceof Error ? error.message : "Unknown error",
      }).show();
    }
  });

  checkShortcut(ret);
};
