/**
 * @file summarization.ts
 * @description IPC handlers for text summarization functionality
 */
import { ipcMain } from "electron";
import { store } from "~/stores/apiStore";
import { summarizeText } from "../../ai.request/summarize";

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
      text: string
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

        const result = await summarizeText(text);
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
