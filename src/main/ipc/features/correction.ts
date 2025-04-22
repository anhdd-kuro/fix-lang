/**
 * @file correction.ts
 * @description IPC handlers for text correction functionality
 */
import { ipcMain } from "electron";
import { store } from "~/stores/apiStore";
import { fixGrammar } from "../../ai.request/correction";
import type { VersionEntry } from "~/stores/apiStore";

/**
 * Registers correction-related IPC handlers
 */
export const registerCorrectionHandlers = () => {
  // Get correction settings
  ipcMain.handle("get-correction-settings", async () => {
    try {
      return store.get("settingsCorrect");
    } catch (error) {
      console.error("Error getting correction settings:", error);
      return {
        paraphrase: false,
        withShorten: false,
        paraphrasePrompt: "",
        userInput: "",
      };
    }
  });

  // Set correction settings
  ipcMain.handle("set-correction-settings", async (_event: Electron.IpcMainInvokeEvent, settings) => {
    try {
      store.set("settingsCorrect", settings);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get correction history
  ipcMain.handle("get-history", async () => {
    try {
      return store.get("history") || [];
    } catch (error) {
      console.error("Error getting correction history:", error);
      return [];
    }
  });

  // Get correction history (alternative endpoint)
  ipcMain.handle("get-correct-history", async (_event: Electron.IpcMainInvokeEvent) => {
    try {
      return store.get("history") as VersionEntry[];
    } catch (error) {
      console.error("Error getting correction history:", error);
      return [];
    }
  });

  // Clear correction history
  ipcMain.handle("clear-history", async () => {
    try {
      store.set("history", []);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get last correction entry
  ipcMain.handle("get-last-history", async () => {
    try {
      const history = store.get("history") as VersionEntry[];
      return history.length > 0 ? history[0] : null;
    } catch (error) {
      console.error("Error getting last history entry:", error);
      return null;
    }
  });

  // Direct grammar fix request (usually from main window or overlays)
  ipcMain.handle(
    "fix-grammar",
    async (_event: Electron.IpcMainInvokeEvent, text: string): Promise<{
      success: boolean;
      correctedText?: string;
      error?: string;
      promptTokens?: number | null;
      completionTokens?: number | null;
    }> => {
      try {
        if (!text || text.trim() === "") {
          return { success: false, error: "No text provided" };
        }

        const apiKey = store.get("apiKey") as string;
        if (!apiKey) {
          return { success: false, error: "API key not set" };
        }

        const result = await fixGrammar(apiKey, text);
        return {
          success: true,
          correctedText: result.correctedText,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
      } catch (error) {
        console.error("Error fixing grammar:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );
};
