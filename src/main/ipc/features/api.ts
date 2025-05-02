/**
 * @file api.ts
 * @description IPC handlers for OpenAI API related functionality
 */
import { ipcMain, dialog } from "electron";
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

      console.log("Fetching AI models (cloud + local)...");
      const apiKey = store.get("apiKey");
      
      // Even if API key is not set, we can still fetch local models
      try {
        const models = await fetchAvailableModels(apiKey || "");
        const localCount = models.filter(m => m.local).length;
        const cloudCount = models.length - localCount;
        
        console.log(
          `Fetched ${models.length} models (${cloudCount} cloud, ${localCount} local)`
        );

        // Store the fetched models
        store.set("models", models);
        return {
          success: true,
          models,
        };
      } catch (fetchError) {
        console.error("Error fetching models:", fetchError);
        
        // If we have stored models, use them as fallback
        if (storedModels?.length > 0) {
          console.log("Using previously cached models as fallback");
          return {
            success: true,
            models: storedModels,
          };
        }
        
        throw fetchError; // Re-throw to be caught by outer catch
      }
    } catch (error) {
      console.error("Error in fetch-ai-models handler:", error);
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

  // Local LLM model management handlers
  ipcMain.handle("open-model-manager", async () => {
    try {
      // For now, we'll just show an info dialog since we don't have a dedicated UI yet
      // In a future implementation, this would open a modal or window with model management UI
      dialog.showMessageBox({
        type: "info",
        title: "Local LLM Models",
        message: "Model management will be implemented in Phase 4",
        detail: "This will allow you to install, update, and remove local models.",
        buttons: ["OK"],
      });
      return;
    } catch (error) {
      console.error("Error opening model manager:", error);
      return;
    }
  });

  ipcMain.handle("pull-local-model", async (_event, modelName) => {
    try {
      // Import the OllamaClient to manage models
      const { OllamaClient } = await import("~/main/llm/ollama/client");
      const client = new OllamaClient();
      
      console.log(`Pulling model: ${modelName}`);
      await client.pullModel(modelName);
      
      // After successful pull, refresh the models list
      const apiKey = store.get("apiKey") || "";
      const models = await fetchAvailableModels(apiKey);
      store.set("models", models);
      
      return { success: true };
    } catch (error) {
      console.error(`Error pulling model ${modelName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("delete-local-model", async (_event, modelName) => {
    try {
      // Import the OllamaClient to manage models
      const { OllamaClient } = await import("~/main/llm/ollama/client");
      const client = new OllamaClient();
      
      console.log(`Deleting model: ${modelName}`);
      await client.deleteModel(modelName);
      
      // After successful deletion, refresh the models list
      const apiKey = store.get("apiKey") || "";
      const models = await fetchAvailableModels(apiKey);
      store.set("models", models);
      
      return { success: true };
    } catch (error) {
      console.error(`Error deleting model ${modelName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Provide a list of recommended models for easy installation
  ipcMain.handle("get-recommended-models", async () => {
    // Return a curated list of recommended local models
    return [
      {
        name: "deepseek-coder:6.7b",
        description: "Efficient code completion model (6.7B parameters)",
        size: 6.7,
        tags: ["code", "lightweight", "efficient"],
      },
      {
        name: "deepseek-coder:33b",
        description: "High-quality code completion model (33B parameters)",
        size: 33,
        tags: ["code", "high-quality", "large"],
      },
      {
        name: "llama2:7b",
        description: "General-purpose language model (7B parameters)",
        size: 7,
        tags: ["general", "lightweight", "chat"],
      },
      {
        name: "codellama:7b",
        description: "Code-optimized LLM based on Llama 2 (7B parameters)",
        size: 7,
        tags: ["code", "lightweight", "programming"],
      },
    ];
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
