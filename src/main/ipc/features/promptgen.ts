/**
 * @file promptgen.ts
 * @description IPC handlers for prompt generation functionality
 */
import { ipcMain, clipboard } from "electron";
import { store } from "~/stores/apiStore";
// Note: generatePrompt is only used in hotkey.ts
// Note: VersionEntry is only needed for history operations in hotkey.ts

/**
 * Registers prompt generation-related IPC handlers
 */
export const registerPromptgenHandlers = () => {
  // Get promptgen settings
  ipcMain.handle("get-promptgen-settings", async () => {
    try {
      return store.get("settingsPromptgen");
    } catch (error) {
      console.error("Error getting promptgen settings:", error);
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

  // Set promptgen settings
  ipcMain.handle("set-promptgen-settings", async (_event, settings) => {
    try {
      store.set("settingsPromptgen", settings);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get promptgen history
  ipcMain.handle("get-promptgen-history", async () => {
    try {
      return store.get("historyPromptgen") || [];
    } catch (error) {
      console.error("Error getting promptgen history:", error);
      return [];
    }
  });

  // Clear promptgen history
  ipcMain.handle("clear-promptgen-history", async () => {
    try {
      store.set("historyPromptgen", []);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

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
