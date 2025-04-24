/**
 * @file settings.ts
 * @description IPC handlers for application settings
 */
import { ipcMain, Notification } from "electron";
import { DEFAULT_KEY_BINDINGS } from "~/const";
import { registerHotkeys, unregisterHotkeys } from "~/main/keybindings";
import { store } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { getMainWindow } from "../../partials/mainWindow";
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
    }
  );

  ipcMain.handle(
    "set-key-bindings",
    async (_event: Electron.IpcMainInvokeEvent, bindings: KeyBindings) => {
      try {
        keybindingStore.setKeyBindings(bindings);
        // Re-register hotkeys with new bindings
        unregisterHotkeys();
        const mainWindow = getMainWindow();
        if (mainWindow) registerHotkeys(mainWindow);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  ipcMain.handle(
    "reset-key-bindings",
    async (_event: Electron.IpcMainInvokeEvent) => {
      try {
        keybindingStore.resetKeyBindings();
        // Re-register hotkeys with default bindings
        unregisterHotkeys();
        const mainWindow = getMainWindow();
        if (mainWindow) registerHotkeys(mainWindow);
        return keybindingStore.getKeyBindings();
      } catch (error) {
        console.error("Failed to reset key bindings:", error);
        // Using the same defaults as in const.ts (source of truth)
        return DEFAULT_KEY_BINDINGS;
      }
    }
  );

  // Hotkey pause/resume
  ipcMain.handle(
    "pause-hotkeys",
    async (_event: Electron.IpcMainInvokeEvent) => {
      console.log("Pausing global hotkeys during edit");
      unregisterHotkeys();
      return; // Explicit return to fix lint issue
    }
  );

  ipcMain.handle(
    "resume-hotkeys",
    async (_event: Electron.IpcMainInvokeEvent) => {
      console.log("Resuming global hotkeys after edit");
      const mainWindow = getMainWindow();
      if (mainWindow) registerHotkeys(mainWindow);
      return; // Explicit return to fix lint issue
    }
  );

  // Prompt settings handlers
  ipcMain.handle(
    "get-prompt-settings",
    async (_event: Electron.IpcMainInvokeEvent) => {
      try {
        // Get settings from the globalSettings object
        const globalSettings = store.get("globalSettings") as {
          customSystemPrompt: string;
          customUserPrompt: string;
          tone: string;
          temperature: number;
          top_p: number;
          maxTokens: number;
        };

        // Return a settings object with defaults if any property is missing
        return {
          customSystemPrompt: globalSettings?.customSystemPrompt || "",
          customUserPrompt: globalSettings?.customUserPrompt || "",
          tone: globalSettings?.tone || "",
          temperature: globalSettings?.temperature || 0.3,
          top_p: globalSettings?.top_p || 1.0,
          maxTokens: globalSettings?.maxTokens || 10000,
        };
      } catch (error) {
        console.error("Failed to get prompt settings:", error);
        return {
          customSystemPrompt: "",
          customUserPrompt: "",
          tone: "",
          temperature: 0.3,
        };
      }
    }
  );

  ipcMain.handle(
    "set-prompt-settings",
    async (
      _event: Electron.IpcMainInvokeEvent,
      settings: {
        customSystemPrompt: string;
        customUserPrompt: string;
        tone: string;
        temperature: number;
        top_p: number;
        maxTokens: number;
      }
    ) => {
      try {
        const {
          customSystemPrompt,
          customUserPrompt,
          tone,
          temperature,
          top_p,
          maxTokens,
        } = settings;

        // Save to the globalSettings object
        store.set("globalSettings", {
          customSystemPrompt,
          customUserPrompt,
          tone,
          temperature,
          top_p,
          maxTokens,
        });

        // Also set to legacy fields for backward compatibility
        store.set("customSystemPrompt", customSystemPrompt);
        store.set("customUserPrompt", customUserPrompt);
        store.set("tone", tone);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Settings notifications
  ipcMain.on("settings-updated", (_event: Electron.IpcMainEvent) => {
    console.log("Settings updated");
    new Notification({
      title: "Settings Updated",
      body: "Your settings have been saved.",
    }).show();
  });
};
