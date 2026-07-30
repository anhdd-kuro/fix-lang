// API-related preload functionality
import { ipcRenderer } from "electron";
import { messageLabel, type Label } from "~/features/i18n/shared/message";
// From the shared registry, never a local copy: a hand-written chain would let
// this boundary silently reject a newly added provider with no type error.
import { isProviderId } from "~/features/providers/shared/providers";
import { asLabel } from "~/features/settings/preload/ipcLabel";
import type { ProviderStates } from "~/features/providers/main/api";
import type { Model, ProviderId } from "~/features/providers/shared/providers";
import type { ClearedModelRefs, Profile } from "~/features/providers/store/apiStore";

/** No `modelId`: connecting a provider must not seed a default model over the user's existing choice. */
export type ProviderConnectInput = {
  provider: ProviderId;
  /** Write-only credential; never returned from main. */
  apiKey?: string;
  /** OpenRouter-only write-only credential. */
  provisioningKey?: string;
  /** AWS Bedrock secret access key (write-only). */
  secretKey?: string;
  /** AWS Bedrock region (stored as host for bedrock endpoint). */
  region?: string;
  /** Local provider host (Ollama / LM Studio; no scheme/path). */
  host?: string;
  /** Local provider port (Ollama / LM Studio). */
  port?: number;
  /**
   * OpenAI project id for the tray's project-spend card. Sent raw so `""` still
   * reaches main as a deliberate clear rather than as "field not submitted".
   */
  projectId?: string;
};

export const isProviderConnectInput = (value: unknown): value is ProviderConnectInput => {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  const hostOk = input.host === undefined || typeof input.host === "string";
  const portOk =
    input.port === undefined ||
    (typeof input.port === "number" && Number.isInteger(input.port)) ||
    typeof input.port === "string";
  return (
    isProviderId(input.provider) &&
    (input.apiKey === undefined || typeof input.apiKey === "string") &&
    (input.provisioningKey === undefined || typeof input.provisioningKey === "string") &&
    (input.secretKey === undefined || typeof input.secretKey === "string") &&
    (input.region === undefined || typeof input.region === "string") &&
    (input.projectId === undefined || typeof input.projectId === "string") &&
    hostOk &&
    portOk
  );
};

/**
 * Exposes API-related functionality to the renderer process
 */
export const apiFeature = {
  // No `getActiveProvider`: requests route by the composite ref they name.

  /**
   * SECURITY: booleans and a count only. No channel returns a decrypted key, a
   * prefix, a suffix, a length or a masked form, and this must never grow one.
   */
  getProviderStates: (): Promise<ProviderStates> =>
    ipcRenderer.invoke("get-provider-states"),

  /** Returns masked credential state for one staged provider. */
  getProviderSecretStatus: async (
    provider: ProviderId,
  ): Promise<{ apiKeySet: boolean; provisioningKeySet: boolean; accessKeySet?: boolean; secretKeySet?: boolean }> => {
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
    setup: ProviderConnectInput,
  ): Promise<{ success: boolean; models?: Model[]; error?: Label }> => {
    if (!isProviderConnectInput(setup)) {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidSetup") };
    }
    const result = await ipcRenderer.invoke("fetch-provider-models", setup);
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Does **not** set a default model — that is `setSelectedModel`. `note` is
   * separate from `error`: it carries advice for a connect that did succeed.
   */
  connectProvider: async (
    input: ProviderConnectInput,
  ): Promise<{
    success: boolean;
    profile?: Profile;
    note?: Label;
    error?: Label;
  }> => {
    if (!isProviderConnectInput(input)) {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidSetup") };
    }
    const result = await ipcRenderer.invoke("connect-provider", input);
    if (result?.success) ipcRenderer.send("settings-updated");
    // SECURITY: explicit fields, never `{ ...result }` — a spread forwards any
    // field a later handler edit adds, credential material included.
    return {
      success: result?.success === true,
      profile: result?.profile,
      note: asLabel(result?.note),
      error: asLabel(result?.error),
    };
  },

  /** `cleared` is main's answer verbatim — the confirmation warning renders it. */
  disconnectProvider: async (
    provider: ProviderId,
  ): Promise<{
    success: boolean;
    profile?: Profile;
    cleared?: ClearedModelRefs;
    error?: Label;
  }> => {
    if (!isProviderId(provider)) {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidSetup") };
    }
    const result = await ipcRenderer.invoke("disconnect-provider", provider);
    if (result?.success) ipcRenderer.send("settings-updated");
    // Explicit fields, same reason as `connectProvider` above.
    return {
      success: result?.success === true,
      profile: result?.profile,
      cleared: result?.cleared,
      error: asLabel(result?.error),
    };
  },

  /**
   * `errors` is per provider — callers must read it rather than treating
   * `success: true` as "everything refreshed".
   */
  fetchAIModels: async (
    refetch?: boolean
  ): Promise<{
    success: boolean;
    models?: Model[];
    errors?: Partial<Record<ProviderId, string>>;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("fetch-ai-models", refetch);
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Pass `""` to inherit the dynamic default. Main stores the canonical
   * composite ref, not the raw input.
   */
  setSelectedModel: async (
    modelId: string,
  ): Promise<{ success: boolean; error?: Label }> => {
    if (typeof modelId !== "string") {
      return { success: false, error: messageLabel("models.select.error.modelNotAvailableForProvider") };
    }
    const result = await ipcRenderer.invoke("set-selected-model", modelId);
    // Gated on success: `settings-updated` triggers a network fan-out across
    // every connected provider, which a rejected ref must not pay for.
    if (result?.success) ipcRenderer.send("settings-updated");
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
