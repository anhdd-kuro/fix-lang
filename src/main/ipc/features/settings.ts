/**
 * @file settings.ts
 * @description IPC handlers for application settings
 */
import { BrowserWindow, ipcMain, Notification } from "electron";
import { DEFAULT_KEY_BINDINGS } from "~/const";
import { reloadHotkeys, unregisterHotkeys } from "~/main/keybindings";
import { keybindingStore } from "~/stores/keybindingStore";
import {
  clearProvisioningKey,
  hasProvisioningKey,
  setProvisioningKey,
} from "~/stores/provisioningKeyStore";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * Registers settings-related IPC handlers
 */
export const registerSettingsHandlers = () => {
  // Keybinding handlers
  ipcMain.handle(
    "get-key-bindings",
    async (_event: Electron.IpcMainInvokeEvent) => {
      try {
        return keybindingStore.getKeyBindings();
      } catch (error) {
        console.error("Failed to get key bindings:", error);
        // Using the same defaults as in const.ts (source of truth)
        return DEFAULT_KEY_BINDINGS;
      }
    },
  );

  ipcMain.handle(
    "set-key-bindings",
    async (_event: Electron.IpcMainInvokeEvent, bindings: KeyBindings) => {
      try {
        keybindingStore.setKeyBindings(bindings);
        reloadHotkeys();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  ipcMain.handle(
    "reset-key-bindings",
    async (_event: Electron.IpcMainInvokeEvent) => {
      try {
        keybindingStore.resetKeyBindings();
        reloadHotkeys();
        return keybindingStore.getKeyBindings();
      } catch (error) {
        console.error("Failed to reset key bindings:", error);
        // Using the same defaults as in const.ts (source of truth)
        return DEFAULT_KEY_BINDINGS;
      }
    },
  );

  // Hotkey pause/resume
  ipcMain.handle(
    "pause-hotkeys",
    async (_event: Electron.IpcMainInvokeEvent) => {
      console.log("Pausing global hotkeys during edit");
      unregisterHotkeys();
      return; // Explicit return to fix lint issue
    },
  );

  ipcMain.handle(
    "resume-hotkeys",
    async (_event: Electron.IpcMainInvokeEvent) => {
      console.log("Resuming global hotkeys after edit");
      reloadHotkeys();
      return; // Explicit return to fix lint issue
    },
  );

  // ---------------------------------------------------------------------------
  // OpenRouter provisioning (admin) key — safeStorage-backed (issue #55).
  // The decrypted key NEVER crosses to the renderer; only set/clear/has are
  // exposed. No "get-provisioning-key" IPC by design — in-main callers (#59)
  // use getProvisioningKey() directly. The key is never logged.
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "set-provisioning-key",
    async (_event: Electron.IpcMainInvokeEvent, raw: unknown) => {
      // Defense-in-depth: re-validate the IPC payload type in main (preload
      // also guards). Reject non-strings without touching the store.
      if (typeof raw !== "string") {
        return { success: false, error: "Invalid key" };
      }
      return setProvisioningKey(raw);
    },
  );

  ipcMain.handle(
    "clear-provisioning-key",
    async (_event: Electron.IpcMainInvokeEvent) => clearProvisioningKey(),
  );

  ipcMain.handle(
    "has-provisioning-key",
    async (_event: Electron.IpcMainInvokeEvent) => hasProvisioningKey(),
  );

  // Settings notifications — re-broadcast to every window (Main, Tray,
  // PromptGen, …) so provider/model/preset changes made in one window reflect
  // immediately everywhere else (see fixlang-profile-state gotcha).
  ipcMain.on("settings-updated", (_event: Electron.IpcMainEvent) => {
    console.log("Settings updated");
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send("settings-updated");
      }
    });
    new Notification({
      title: "Settings Updated",
      body: "Your settings have been saved.",
    }).show();
  });
};
