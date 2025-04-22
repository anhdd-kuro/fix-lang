/**
 * @file promptgen.ts
 * @description IPC handlers for prompt generation functionality
 */
import { ipcMain, clipboard } from "electron";
import { store } from "~/stores/apiStore";
import { generatePrompt } from "../../ai.request/promptgen";
import type { VersionEntry } from "~/stores/apiStore";

/**
 * Registers prompt generation-related IPC handlers
 */
export const registerPromptgenHandlers = () => {
  // Get promptgen settings
  ipcMain.handle("get-promptgen-settings", async () => {
    try {
      return store.get("settingsPromptGen") || {
        minLength: 50,
        maxLength: 150,
        batchCount: 5,
        nsfw: true,
        context: "",
        autoCopy: false,
      };
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
      store.set("settingsPromptGen", settings);
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
      return store.get("historyPromptGen") || [];
    } catch (error) {
      console.error("Error getting promptgen history:", error);
      return [];
    }
  });

  // Clear promptgen history
  ipcMain.handle("clear-promptgen-history", async () => {
    try {
      store.set("historyPromptGen", []);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Generate prompts
  ipcMain.handle("generate-prompt", async (_event, text: string) => {
    try {
      const apiKey = store.get("apiKey");
      if (!apiKey) throw new Error("API key not set");

      // Get all required settings
      const promptgenSettings = store.get("settingsPromptGen");
      const model = store.get("selectedModel") as string;
      const temperature = store.get("temperature") as number;

      const result = await generatePrompt({
        apiKey,
        text,
        minLength: promptgenSettings.minLength,
        maxLength: promptgenSettings.maxLength,
        batchCount: promptgenSettings.batchCount,
        nsfw: promptgenSettings.nsfw,
        context: promptgenSettings.context || "",
        model,
        temperature,
      });

      // Save to history if generation was successful
      if (result.prompts.length > 0) {
        try {
          // Save generated prompts to history
          const entries: VersionEntry[] = result.prompts.map(prompt => ({
            original: text,
            corrected: prompt,
            timestamp: new Date().toISOString(),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          }));

          const history = (store.get("historyPromptGen") as VersionEntry[]) ?? [];
          // Add new entries at the beginning
          store.set("historyPromptGen", [...entries, ...history].slice(0, 50));
        } catch (e) {
          console.error("Failed to save prompt generation history:", e);
        }
      }

      return {
        success: true,
        ...result,
        autoCopy: promptgenSettings.autoCopy || false,
      };
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
