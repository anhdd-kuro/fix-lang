// API-related preload functionality
import { ipcRenderer } from "electron";
import type { Model } from "~/stores/apiStore";

/**
 * Exposes API-related functionality to the renderer process
 */
export const apiFeature = {
  /**
   * Fetches the list of available OpenAI models using the stored API key.
   * @returns A promise resolving to { success: boolean, models?: Model[], error?: string }
   */
  fetchAIModels: async (
    refetch?: boolean
  ): Promise<{
    success: boolean;
    models?: Model[];
    error?: string;
  }> => {
    return await ipcRenderer.invoke("fetch-ai-models", refetch);
  },

  /**
   * Sets the selected OpenAI model for future requests
   */
  setSelectedModel: async (modelId: string) => {
    const result = await ipcRenderer.invoke("set-selected-model", modelId);
    ipcRenderer.send("settings-updated");
    return result;
  },

  /**
   * Gets the currently selected OpenAI model
   */
  getSelectedModel: async () => {
    return await ipcRenderer.invoke("get-selected-model");
  },

  /**
   * Resets the current profile's settings to defaults (keeps the API key).
   */
  resetProfileSettings: async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const result = await ipcRenderer.invoke("reset-profile-settings");
    ipcRenderer.send("settings-updated");
    return result;
  },

  /**
   * Store the API key securely (safeStorage in main). The plaintext is sent to
   * main only to be encrypted — it is never returned to the renderer.
   */
  setApiKey: (key: string): Promise<{ success: boolean; warning?: string; error?: string }> => {
    if (typeof key !== "string") {
      return Promise.resolve({ success: false, error: "Invalid key" });
    }
    return ipcRenderer.invoke("set-api-key", key);
  },

  /**
   * Whether an API key is currently stored. Drives the masked UI state; the
   * actual key value is never exposed to the renderer.
   */
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke("has-api-key"),

  /** Remove the stored API key. */
  clearApiKey: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("clear-api-key"),

  /**
   * Gets the model for a specific feature or returns the general default.
   */
  getFeatureModel: async (feature: string): Promise<string> => {
    return await ipcRenderer.invoke("get-feature-model", feature);
  },

  /**
   * Sets the model for a specific feature.
   */
  setFeatureModel: async (
    feature: string,
    model: string
  ): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke("set-feature-model", feature, model);
  },

  /**
   * Shows the model manager dialog
   * This triggers the display of the ModelManagerDialog component in the renderer
   * @returns A promise that resolves with a success flag
   */
  openModelManager: async (): Promise<{ success: boolean }> => {
    // Instead of waiting for main process, we'll directly trigger the UI
    // by dispatching a custom event that our component listens for
    window.dispatchEvent(new CustomEvent("openModelManager"));

    // For compatibility, still call the IPC handler but don't wait for it
    ipcRenderer.invoke("open-model-manager").catch((error) => {
      console.warn("Failed to notify main process about model manager:", error);
    });

    return { success: true };
  },

  /**
   * Pulls a local model from Ollama
   * @param modelName The name of the model to pull (e.g., "deepseek-coder:6.7b")
   * @returns A promise that resolves with status of the pull operation
   */
  pullLocalModel: async (
    modelName: string
  ): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke("pull-local-model", modelName);
  },

  /**
   * Deletes a local model from Ollama
   * @param modelName The name of the model to delete
   * @returns A promise that resolves with status of the delete operation
   */
  deleteLocalModel: async (
    modelName: string
  ): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke("delete-local-model", modelName);
  },

  /**
   * Gets the list of recommended local models
   * @returns A promise that resolves with an array of recommended model information
   */
  getRecommendedModels: async (): Promise<
    {
      name: string;
      description: string;
      size: number;
      tags: string[];
      requirements?: {
        minRam?: number;
        minDisk?: number;
        gpu?: boolean;
      };
    }[]
  > => {
    return await ipcRenderer.invoke("get-recommended-models");
  },

  /**
   * Checks if the user's system is compatible with a specific model
   * @param modelName The name of the model to check compatibility for
   * @returns A promise that resolves with compatibility information
   */
  checkModelCompatibility: async (
    modelName: string
  ): Promise<{
    success: boolean;
    compatibility?: {
      compatible: boolean;
      issues: string[];
      recommendations: string[];
      details: {
        availableRam: number;
        availableDisk: number;
        cpuCores: number;
        hasGpu: boolean;
        gpuInfo?: string;
      };
    };
    error?: string;
  }> => {
    return await ipcRenderer.invoke("check-model-compatibility", modelName);
  },
};

export type ApiFeature = typeof apiFeature;
