/**
 * @file summarization.ts
 * @description IPC handlers for text summarization functionality
 */
import { ipcMain } from "electron";
import { store } from "~/stores/apiStore";
import { addHistoryEntry } from "~/stores/historyStore";
import { summarizeText } from "../../ai.request/summarize";
import type { HistoryEntry } from "~/stores/historyStore";

/**
 * Registers summarization-related IPC handlers
 */
export const registerSummarizationHandlers = () => {
  // Get summarize settings
  ipcMain.handle("get-summarize-settings", async () => {
    try {
      return (
        store.get("settingsSummarize") || {
          minLength: 0,
          maxLength: 0,
        }
      );
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

  // Note: All history-related IPC handlers have been moved to the centralized history.ts module

  // Summarize text
  ipcMain.handle(
    "summarize-text",
    async (
      _event,
      text: string,
      maxInput = 500
    ): Promise<{
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

        // Save summarization to history using centralized history manager
        try {
          const entry: HistoryEntry = {
            original: text,
            corrected: result.summarizedText,
            timestamp: new Date().toISOString(),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          };

          // Use the centralized history manager
          addHistoryEntry("summarize", entry, 20);

          // No need to notify windows manually as it's handled by centralized history manager
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
