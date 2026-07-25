/**
 * @file correction.ts
 * @description IPC handlers for text correction functionality
 */
import { ipcMain } from "electron";
import { reloadHotkeys } from "~/main/keybindings";
import {
  getDefaultCorrectionSettings,
  getProfileSetting,
  updateProfileSetting,
} from "~/stores/apiStore";
import { fixGrammar } from "../../ai.request/correction";

/**
 * Registers correction-related IPC handlers
 */
export const registerCorrectionHandlers = () => {
  // Get correction settings
  ipcMain.handle("get-correction-settings", async () => {
    try {
      return getProfileSetting("settingsCorrect");
    } catch (error) {
      console.error("Error getting correction settings:", error);
      return {
        ...getDefaultCorrectionSettings(),
      };
    }
  });

  // Alias for get-correction-settings to match preload API naming
  ipcMain.handle("get-correct-settings", async () => {
    try {
      return getProfileSetting("settingsCorrect");
    } catch (error) {
      console.error("Error getting correct settings:", error);
      return {
        ...getDefaultCorrectionSettings(),
      };
    }
  });

  // Set correction settings
  ipcMain.handle(
    "set-correction-settings",
    async (_event: Electron.IpcMainInvokeEvent, settings) => {
      try {
        const result = updateProfileSetting("settingsCorrect", settings);
        if (result.success) {
          reloadHotkeys();
        }
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Alias for set-correction-settings to match preload API naming
  ipcMain.handle(
    "set-correct-settings",
    async (_event: Electron.IpcMainInvokeEvent, settings) => {
      try {
        const result = updateProfileSetting("settingsCorrect", settings);
        if (result.success) {
          reloadHotkeys();
        }
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Note: All history-related IPC handlers have been moved to the centralized history.ts module

  // Direct grammar fix request (usually from main window or overlays)
  ipcMain.handle(
    "fix-grammar",
    async (
      _event: Electron.IpcMainInvokeEvent,
      payload: { text: string; presetId?: string },
    ): Promise<{
      success: boolean;
      correctedText?: string;
      error?: string;
      promptTokens?: number;
      completionTokens?: number;
      model?: string;
      provider?: "openai" | "openrouter" | "ollama";
      resolvedModel?: string;
      presetId?: string;
      presetName?: string;
    }> => {
      try {
        const { text, presetId } = payload;

        if (!text || text.trim() === "") {
          return { success: false, error: "No text provided" };
        }

        const result = await fixGrammar(text, presetId);

        return {
          success: true,
          correctedText: result.correctedText,
          promptTokens: result.promptTokens ?? 0,
          completionTokens: result.completionTokens ?? 0,
          model: result.model,
          provider: result.provider,
          resolvedModel: result.resolvedModel,
          presetId: result.presetId,
          presetName: result.presetName,
        };
      } catch (error) {
        console.error("Error fixing grammar:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );
};
