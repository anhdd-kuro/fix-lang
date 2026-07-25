// API-related preload functionality
import { ipcRenderer } from "electron";
import { messageLabel, type Label } from "~/shared/i18n/message";
import { asLabel } from "./ipcLabel";
import type { Model, Profile, ProviderId } from "~/stores/apiStore";

export type ProviderSetupInput = {
  provider: ProviderId;
  modelId: string;
  /** Write-only credential; never returned from main. */
  apiKey?: string;
  /** OpenRouter-only write-only credential. */
  provisioningKey?: string;
};

const isProviderId = (value: unknown): value is ProviderId =>
  value === "openai" || value === "openrouter" || value === "ollama";

export const isProviderSetupInput = (value: ProviderSetupInput): boolean =>
  isProviderId(value.provider) &&
  typeof value.modelId === "string" &&
  (value.apiKey === undefined || typeof value.apiKey === "string") &&
  (value.provisioningKey === undefined || typeof value.provisioningKey === "string");

/**
 * Exposes API-related functionality to the renderer process
 */
export const apiFeature = {
  /** Reads the currently active provider (for provider-label display). */
  getActiveProvider: (): Promise<ProviderId> =>
    ipcRenderer.invoke("get-active-provider"),

  /** Returns masked credential state for one staged provider. */
  getProviderSecretStatus: async (
    provider: ProviderId,
  ): Promise<{ apiKeySet: boolean; provisioningKeySet: boolean }> => {
    if (!isProviderId(provider)) {
      return { apiKeySet: false, provisioningKeySet: false };
    }
    return ipcRenderer.invoke("get-provider-secret-status", provider);
  },

  /**
   * Fetch models for a staged provider without changing the active provider or
   * persisting the optional typed key.
   */
  fetchProviderModels: async (
    setup: ProviderSetupInput,
  ): Promise<{ success: boolean; models?: Model[]; error?: Label }> => {
    if (!isProviderSetupInput(setup)) {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidSetup") };
    }
    const result = await ipcRenderer.invoke("fetch-provider-models", setup);
    return { ...result, error: asLabel(result?.error) };
  },

  /** Commit a validated provider, default model, cache, and supplied secrets. */
  applyProviderSetup: async (
    setup: ProviderSetupInput,
  ): Promise<{ success: boolean; profile?: Profile; error?: Label }> => {
    if (!isProviderSetupInput(setup)) {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidSetup") };
    }
    const result = await ipcRenderer.invoke("apply-provider-setup", setup);
    if (result.success) ipcRenderer.send("settings-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Fetches the list of available OpenAI models using the stored API key.
   * @returns A promise resolving to { success: boolean, models?: Model[], error?: Label }
   */
  fetchAIModels: async (
    refetch?: boolean
  ): Promise<{
    success: boolean;
    models?: Model[];
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("fetch-ai-models", refetch);
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Sets the selected OpenAI model for future requests
   */
  setSelectedModel: async (
    modelId: string,
  ): Promise<{ success: boolean; error?: Label }> => {
    const result = await ipcRenderer.invoke("set-selected-model", modelId);
    ipcRenderer.send("settings-updated");
    return { ...result, error: asLabel(result?.error) };
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
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("reset-profile-settings");
    ipcRenderer.send("settings-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Store the API key securely (safeStorage in main). The plaintext is sent to
   * main only to be encrypted — it is never returned to the renderer.
   */
  setApiKey: async (
    key: string,
  ): Promise<{ success: boolean; error?: Label }> => {
    if (typeof key !== "string") {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidApiKeyInput") };
    }
    const result = await ipcRenderer.invoke("set-api-key", key);
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Whether an API key is currently stored. Drives the masked UI state; the
   * actual key value is never exposed to the renderer.
   */
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke("has-api-key"),

  /** Remove the stored API key. */
  clearApiKey: async (): Promise<{ success: boolean; error?: Label }> => {
    const result = await ipcRenderer.invoke("clear-api-key");
    return { ...result, error: asLabel(result?.error) };
  },

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
  ): Promise<{ success: boolean; error?: Label }> => {
    const result = await ipcRenderer.invoke("set-feature-model", feature, model);
    return { ...result, error: asLabel(result?.error) };
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
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("check-model-compatibility", modelName);
    return { ...result, error: asLabel(result?.error) };
  },
};

export type ApiFeature = typeof apiFeature;
