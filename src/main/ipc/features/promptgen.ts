/**
 * @file promptGen.ts
 * @description IPC handlers for prompt generation functionality
 */
import { ipcMain, clipboard, BrowserWindow } from "electron";
import { store } from "~/stores/apiStore";
// Note: generatePrompt is only used in hotkey.ts

/**
 * Registers prompt generation-related IPC handlers
 */
export const registerPromptGenHandlers = () => {
  // Get promptGen settings
  ipcMain.handle("get-promptGen-settings", async () => {
    try {
      return store.get("settingsPromptGen");
    } catch (error) {
      console.error("Error getting promptGen settings:", error);
      return {
        minLength: 50,
        maxLength: 150,
        batchCount: 5,
        nsfw: true,
        context: "",
        autoCopy: false,
      };
    }
  });

  // Set promptGen settings
  ipcMain.handle("set-promptGen-settings", async (_event, settings) => {
    try {
      store.set("settingsPromptGen", settings);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get promptGen history
  ipcMain.handle("get-promptGen-history", async () => {
    try {
      return store.get("historyPromptGen") || [];
    } catch (error) {
      console.error("Error getting promptGen history:", error);
      return [];
    }
  });

  // Clear promptGen history
  ipcMain.handle("clear-promptGen-history", async () => {
    try {
      store.set("historyPromptGen", []);

      // Notify all windows of history update
      BrowserWindow.getAllWindows().forEach(
        (window: Electron.BrowserWindow) => {
          if (!window.isDestroyed()) {
            window.webContents.send("promptGen-history-updated");
          }
        }
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Note: Prompt generation and history management is handled in hotkey.ts directly

  // Note: Prompt generation is handled directly through the keyboard shortcut handler in hotkey.ts
  // No IPC handler is needed for generating prompts since it's not called from the renderer

  // Copy generated prompt to clipboard
  ipcMain.handle("copy-generated-prompt", async (_event, text: string) => {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
};
