/**
 * @file promptGen.ts
 * @description IPC handlers for prompt generation functionality
 */
import { ipcMain, clipboard } from "electron";
import { getProfileSetting, updateProfileSetting } from "~/stores/apiStore";
// Note: generatePrompt is only used in hotkey.ts

/**
 * Registers prompt generation-related IPC handlers
 */
export const registerPromptGenHandlers = () => {
  // Get promptGen settings
  ipcMain.handle("get-promptGen-settings", async () => {
    try {
      return getProfileSetting("settingsPromptGen");
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
      const result = updateProfileSetting("settingsPromptGen", settings);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

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
