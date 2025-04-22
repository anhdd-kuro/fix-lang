/**
 * @file translation.ts
 * @description IPC handlers for text translation functionality
 */
import { ipcMain, clipboard } from "electron";
import { store } from "~/stores/apiStore";
import { translateText } from "../../ai.request/translate";
import { showTranslationWindow } from "../../partials/translationWindow";
import type { VersionEntry } from "~/stores/apiStore";

/**
 * Registers translation-related IPC handlers
 */
export const registerTranslationHandlers = () => {
  // Get translation settings
  ipcMain.handle("get-translation-settings", async () => {
    try {
      return (
        store.get("settingsTranslate") || {
          destinationLang: "",
          includeExplanation: false,
        }
      );
    } catch (error) {
      console.error("Error getting translation settings:", error);
      return {
        destinationLang: "",
        includeExplanation: false,
      };
    }
  });
  
  // Alias for get-translation-settings to match preload API naming
  ipcMain.handle("get-translate-settings", async () => {
    try {
      return (
        store.get("settingsTranslate") || {
          destinationLang: "",
          includeExplanation: false,
        }
      );
    } catch (error) {
      console.error("Error getting translate settings:", error);
      return {
        destinationLang: "",
        includeExplanation: false,
      };
    }
  });

  // Set translation settings
  ipcMain.handle("set-translation-settings", async (_event, settings) => {
    try {
      store.set("settingsTranslate", settings);
      // Also update the standalone translationTargetLang for backwards compatibility
      if (settings.destinationLang) {
        store.set("translationTargetLang", settings.destinationLang);
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get translation history
  ipcMain.handle("get-translation-history", async () => {
    try {
      return store.get("translations") || [];
    } catch (error) {
      console.error("Error getting translation history:", error);
      return [];
    }
  });

  // Clear translation history
  ipcMain.handle("clear-translation-history", async () => {
    try {
      store.set("translations", []);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Translate text
  ipcMain.handle(
    "translate-text",
    async (
      _event,
      text: string,
      targetLang: string
    ): Promise<{
      success: boolean;
      translatedText?: string;
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

        const result = await translateText(apiKey, text, targetLang);

        // Save translation to history
        try {
          const entry: VersionEntry = {
            original: text,
            corrected: result.translatedText,
            timestamp: new Date().toISOString(),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          };
          const translations =
            (store.get("translations") as VersionEntry[]) ?? [];
          translations.unshift(entry);
          if (translations.length > 20) translations.pop();
          store.set("translations", translations);
        } catch (e) {
          console.error("Failed to save translation history entry:", e);
        }

        return {
          success: true,
          translatedText: result.translatedText,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
      } catch (error) {
        console.error("Error translating text:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Show translation window
  ipcMain.handle(
    "show-translation-window",
    async (
      _event,
      params: {
        text: string;
        x: number;
        y: number;
      }
    ): Promise<boolean> => {
      try {
        // Ensure the function returns a boolean
        showTranslationWindow({
          translatedText: params.text,
          x: params.x,
          y: params.y,
          promptTokens: null,
          completionTokens: null
        });
        return true;
      } catch (error) {
        console.error("Error showing translation window:", error);
        return false;
      }
    }
  );

  // Copy translation to clipboard
  ipcMain.handle("copy-translation", async (_event, text: string) => {
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
