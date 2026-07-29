/**
 * @file settings.ts
 * @description IPC handlers for application settings
 */
import { BrowserWindow, ipcMain, Notification } from "electron";
import { DEFAULT_KEY_BINDINGS } from "~/const";
import { reloadHotkeys, unregisterHotkeys } from "~/main/keybindings";
import { messageLabel } from "~/shared/i18n/message";
import { normalizeCorrectionOutputMode } from "~/shared/outputMode";
import { supportsAdminKey } from "~/shared/providers";
import {
  sanitizeReasoningEffort,
} from "~/shared/reasoningEffort";
import { keybindingStore } from "~/stores/keybindingStore";
import { outputModeStore } from "~/stores/outputModeStore";
import {
  clearProvisioningKey,
  hasProvisioningKey,
  setProvisioningKey,
} from "~/stores/provisioningKeyStore";
import { exceptionLabel, wrapStoreResult } from "./ipcResultLabel";
import { buildSettingsSavedNotification } from "./settingsNotifications";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * Registers settings-related IPC handlers
 */
export const registerSettingsHandlers = () => {
  ipcMain.handle("get-correction-output-mode", async () =>
    outputModeStore.getCorrectionOutputMode(),
  );

  ipcMain.handle("get-default-reasoning-effort", async () => {
    const { getDefaultReasoningEffort } = await import("~/stores/apiStore");
    return getDefaultReasoningEffort();
  });

  ipcMain.handle(
    "set-default-reasoning-effort",
    async (_event: Electron.IpcMainInvokeEvent, raw: unknown) => {
      const effort = sanitizeReasoningEffort(raw);
      if (effort === undefined) {
        return {
          success: false,
          error: messageLabel("settings.general.reasoning.invalid"),
        };
      }
      const { updateProfileSetting } = await import("~/stores/apiStore");
      const result = updateProfileSetting("defaultReasoningEffort", effort);
      if (!result.success) return wrapStoreResult(result);
      return { success: true, effort };
    },
  );

  ipcMain.handle(
    "set-correction-output-mode",
    async (_event: Electron.IpcMainInvokeEvent, raw: unknown) => {
      if (raw !== "paste" && raw !== "popup") {
        return {
          success: false,
          error: messageLabel("settings.general.outputMode.invalid"),
        };
      }

      const mode = normalizeCorrectionOutputMode(raw);
      outputModeStore.setCorrectionOutputMode(mode);
      return { success: true, mode };
    },
  );

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
          error: exceptionLabel(error),
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
  // Provider admin keys — OpenRouter provisioning, OpenAI Admin (issues #55/#59).
  // The decrypted key NEVER crosses to the renderer; only set/clear/has are
  // exposed. No "get-provisioning-key" IPC by design — in-main callers use
  // getProvisioningKey(provider) directly. The key is never logged.
  //
  // `provider` is required on every channel and validated here as well as in
  // preload: an unvalidated or defaulted provider would silently write one
  // account's admin key into another provider's slot.
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "set-provisioning-key",
    async (
      _event: Electron.IpcMainInvokeEvent,
      rawProvider: unknown,
      raw: unknown,
    ) => {
      // Defense-in-depth: re-validate the IPC payload in main (preload also
      // guards). Reject bad provider/non-strings without touching the store.
      if (!supportsAdminKey(rawProvider) || typeof raw !== "string") {
        return {
          success: false,
          error: messageLabel("settings.general.provisioningKey.invalid"),
        };
      }
      // `setProvisioningKey` (provisioningKeyStore.ts) is outside this
      // migration's scope — its error text is boundary-wrapped as opaque
      // via `wrapStoreResult` rather than guessed at as translatable, and it
      // keeps this handler's `error` field uniformly `Label`-shaped so the
      // preload boundary's `asLabel()` never has to drop a legitimate string.
      return wrapStoreResult(await setProvisioningKey(rawProvider, raw));
    },
  );

  ipcMain.handle(
    "clear-provisioning-key",
    async (_event: Electron.IpcMainInvokeEvent, rawProvider: unknown) => {
      if (!supportsAdminKey(rawProvider)) {
        return {
          success: false,
          error: messageLabel("settings.general.provisioningKey.invalid"),
        };
      }
      return wrapStoreResult(await clearProvisioningKey(rawProvider));
    },
  );

  ipcMain.handle(
    "has-provisioning-key",
    async (_event: Electron.IpcMainInvokeEvent, rawProvider: unknown) =>
      supportsAdminKey(rawProvider) ? hasProvisioningKey(rawProvider) : false,
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
    new Notification(buildSettingsSavedNotification()).show();
  });
};
