/**
 * @file api.ts
 * @description IPC handlers for OpenAI API related functionality
 */
import { ipcMain } from "electron";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { store } from "~/stores/apiStore";
import { fetchAvailableModels } from "../../ai.request";

/**
 * Registers API-related IPC handlers
 */
export const registerApiHandlers = () => {
  // API key handlers
  ipcMain.handle("get-api-key", async () => {
    try {
      const apiKey = store.get("apiKey");
      return apiKey || "";
    } catch (error) {
      console.error("Failed to get API key:", error);
      return "";
    }
  });

  ipcMain.handle("set-api-key", async (_event, apiKey: string) => {
    try {
      if (typeof apiKey !== "string") throw new Error("Invalid API key");
      store.set("apiKey", apiKey);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // OpenAI model handlers
  ipcMain.handle("fetch-ai-models", async (_event, refetch = false) => {
    try {
      // Check if we already have models in the store and refetch is false
      const storedModels = store.get("models");
      if (storedModels?.length > 0 && !refetch) {
        console.log("Using cached models from store");
        return {
          success: true,
          models: storedModels,
        };
      }

      console.log("Fetching OpenAI models...");
      const apiKey = store.get("apiKey");
      if (!apiKey) {
        console.error("No API key found in store");
        return {
          success: false,
          error: "API key not set",
          models: [],
        };
      }

      const models = await fetchAvailableModels(apiKey);
      console.log(`Fetched ${models.length} models from OpenRouter`);

      // Store the fetched models
      store.set("models", models);
      return {
        success: true,
        models,
      };
    } catch (error) {
      console.error("Error in fetch-openai-models handler:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        models: [],
      };
    }
  });

  ipcMain.handle("get-selected-model", () => {
    try {
      return store.get("selectedModel") || DEFAULT_OPENAI_MODEL;
    } catch (error) {
      console.error("Error getting selected model:", error);
      return DEFAULT_OPENAI_MODEL;
    }
  });

  ipcMain.handle("set-selected-model", (_event, model: string) => {
    try {
      store.set("selectedModel", model);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Feature-specific model settings
  ipcMain.handle("get-feature-model", (_event, feature: string) => {
    const model = store.get<string>(`${feature}.model`);
    return model || store.get<string>("selectedModel") || DEFAULT_OPENAI_MODEL;
  });
  ipcMain.handle(
    "set-feature-model",
    (_event, feature: string, model: string) => {
      try {
        store.set(`${feature}.model`, model);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );
};
