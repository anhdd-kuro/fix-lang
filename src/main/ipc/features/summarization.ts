/**
 * @file summarization.ts
 * @description IPC handlers for text summarization functionality
 */
import { ipcMain, BrowserWindow } from "electron";
import { store } from "~/stores/apiStore";
import { summarizeText } from "../../ai.request/summarize";
import type { VersionEntry } from "~/stores/apiStore";

/**
 * Registers summarization-related IPC handlers
 */
export const registerSummarizationHandlers = () => {
  // Get summarize settings
  ipcMain.handle("get-summarize-settings", async () => {
    try {
      return store.get("settingsSummarize") || {
        minLength: 0,
        maxLength: 0,
      };
    } catch (error) {
      console.error("Error getting summarize settings:", error);
      return {
        minLength: 0,
        maxLength: 0,
      };
    }
  });

  // Set summarize settings
  ipcMain.handle("set-summarize-settings", async (_event, settings) => {
    try {
      store.set("settingsSummarize", settings);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get summarize history
  ipcMain.handle("get-summarize-history", async () => {
    try {
      return store.get("historySummarize") || [];
    } catch (error) {
      console.error("Error getting summarize history:", error);
      return [];
    }
  });

  // Clear summarize history
  ipcMain.handle("clear-summarize-history", async () => {
    try {
      store.set("historySummarize", []);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Summarize text
  ipcMain.handle(
    "summarize-text",
    async (_event, text: string, maxInput = 500): Promise<{
      success: boolean;
      summarizedText?: string;
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

        const result = await summarizeText(apiKey, text, maxInput);
        
        // Save summarization to history
        try {
          const entry: VersionEntry = {
            original: text,
            corrected: result.summarizedText,
            timestamp: new Date().toISOString(),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          };
          const historySummarize = (store.get("historySummarize") as VersionEntry[]) ?? [];
          historySummarize.unshift(entry);
          if (historySummarize.length > 20) historySummarize.pop();
          store.set("historySummarize", historySummarize);
          
          // Notify all windows of history update
          BrowserWindow.getAllWindows().forEach((window) => {
            if (!window.isDestroyed()) {
              window.webContents.send("summarize-history-updated");
            }
          });
        } catch (e) {
          console.error("Failed to save summarize history entry:", e);
        }

        return {
          success: true,
          summarizedText: result.summarizedText,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
      } catch (error) {
        console.error("Error summarizing text:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );
};
