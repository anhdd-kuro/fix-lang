/**
 * @file api.ts
 * @description IPC handlers for OpenAI API related functionality
 */
import { ipcMain } from "electron";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { fetchAvailableModels } from "~/main/ai.request";
import { ollamaClient } from "~/main/llm";
import { checkModelCompatibility } from "~/main/llm/models/compatibility";
import {
  findRecommendedModel,
  getRecommendedModels,
} from "~/main/llm/models/recommended";
import { apiStore } from "~/stores/apiStore";

/**
 * Registers API-related IPC handlers
 */
export const registerApiHandlers = (): void => {
  // API key handling
  ipcMain.handle("get-api-key", () => {
    return apiStore.get("apiKey") || "";
  });

  ipcMain.handle("set-api-key", (_event, apiKey) => {
    try {
      // Set the API key in the store
      apiStore.set("apiKey", apiKey);
      console.log("API key saved successfully");
      return { success: true };
    } catch (error) {
      console.error("Error saving API key:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Model handling
  ipcMain.handle("fetch-ai-models", async () => {
    try {
      // Fetch models from API
      const apiKey = apiStore.get("apiKey") || "";
      const models = await fetchAvailableModels(apiKey);

      // Store the models in the store
      apiStore.set("models", models);

      return {
        success: true,
        models,
      };
    } catch (error) {
      console.error("Error fetching models:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Fallback to cached models if API call fails
  ipcMain.handle("get-cached-models", () => {
    const models = apiStore.get("models") || [];
    return models;
  });

  ipcMain.handle("get-selected-model", () => {
    return apiStore.get("selectedModel") || DEFAULT_OPENAI_MODEL;
  });

  ipcMain.handle("set-selected-model", async (_event, modelId) => {
    try {
      console.log(`[DEBUG IPC] Setting selected model via IPC to: ${modelId}`);

      // Sanity check - verify this model exists
      const models = apiStore.get("models") || [];
      const model = models.find((m) => m.id === modelId);
      console.log(`[DEBUG IPC] Model found in registry: ${!!model}`);
      if (model) {
        console.log(
          `[DEBUG IPC] Model details: local=${!!model.local}, name=${model.name}`
        );
      }

      // Save to store
      apiStore.set("selectedModel", modelId);

      // Double-check it was saved correctly
      const savedModel = apiStore.get("selectedModel");
      console.log(`[DEBUG IPC] Verified saved model ID: ${savedModel}`);
      console.log(`[DEBUG IPC] Models match: ${savedModel === modelId}`);

      return { success: true };
    } catch (error) {
      console.error("Error setting selected model:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Feature-specific model settings
  ipcMain.handle("get-feature-model", (_event, feature) => {
    const featureSetting = apiStore.get(`${feature}`);
    if (
      featureSetting &&
      typeof featureSetting === "object" &&
      "model" in featureSetting
    )
      return featureSetting.model;

    return apiStore.get("selectedModel");
  });

  ipcMain.handle("set-feature-model", async (_event, feature, model) => {
    try {
      apiStore.set(`${feature}`, { model });
      console.log(`Set ${feature} model to: ${model}`);
      return { success: true };
    } catch (error) {
      console.error("Error setting feature model:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Local LLM model management handlers
  ipcMain.handle("open-model-manager", async () => {
    try {
      // The model manager is now implemented as a React component in the renderer
      return { success: true };
    } catch (error) {
      console.error("Error opening model manager:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("pull-local-model", async (_event, modelName) => {
    try {
      console.log(`Pulling local model: ${modelName}`);

      // Check if Ollama is running and available

      // First check if model is compatible with the system
      const recommendedModel = findRecommendedModel(modelName);
      if (recommendedModel) {
        const compatibility = await checkModelCompatibility(recommendedModel);
        if (!compatibility.compatible) {
          console.warn(
            `System compatibility issues for model ${modelName}:`,
            compatibility.issues.join(", ")
          );

          // We could return the issues here, but for now, we'll just log and proceed
          // If you want to block the installation, uncomment below:
          /*
          return {
            success: false,
            error: `System compatibility issues: ${compatibility.issues.join(', ')}`,
            compatibility
          };
          */
        }
      }

      // Proceed with the model pull
      const result = await ollamaClient.pull(modelName);
      return result;
    } catch (error) {
      console.error("Error pulling local model:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("delete-local-model", async (_event, modelName) => {
    try {
      console.log(`Deleting local model: ${modelName}`);
      const result = await ollamaClient.delete(modelName);
      return result;
    } catch (error) {
      console.error("Error deleting local model:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("get-recommended-models", async () => {
    try {
      // Return the curated list of recommended models
      return getRecommendedModels();
    } catch (error) {
      console.error("Error getting recommended models:", error);
      return [];
    }
  });

  ipcMain.handle("check-model-compatibility", async (_event, modelName) => {
    try {
      const model = findRecommendedModel(modelName);
      if (!model) {
        return {
          success: false,
          error: `Model ${modelName} not found in recommended models list`,
        };
      }

      const compatibility = await checkModelCompatibility(model);
      return {
        success: true,
        compatibility,
      };
    } catch (error) {
      console.error("Error checking model compatibility:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
};
