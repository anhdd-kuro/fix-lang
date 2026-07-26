// API-related preload functionality
import { ipcRenderer } from "electron";
import { messageLabel, type Label } from "~/shared/i18n/message";
// `isProviderId` comes from the shared registry, NOT a copy declared here. The
// copy this replaces was a hand-written `=== "openai" || …` chain, so adding a
// provider to `PROVIDER_IDS` would have left the preload boundary silently
// rejecting it with no type error and no failing test.
import { isProviderId } from "~/shared/providers";
import { asLabel } from "./ipcLabel";
import type { ProviderStates } from "~/main/ipc/features/api";
import type { Model, ProviderId } from "~/shared/providers";
import type { ClearedModelRefs, Profile } from "~/stores/apiStore";

/**
 * The payload of `connectProvider`.
 *
 * **No `modelId`** — connecting a provider and choosing a default model are
 * separate actions on separate surfaces now. Connecting must not seed a
 * model, because that overwrote choices the user had already made against
 * another provider.
 */
export type ProviderConnectInput = {
  provider: ProviderId;
  /** Write-only credential; never returned from main. */
  apiKey?: string;
  /** OpenRouter-only write-only credential. */
  provisioningKey?: string;
};

export const isProviderConnectInput = (value: unknown): value is ProviderConnectInput => {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  return (
    isProviderId(input.provider) &&
    (input.apiKey === undefined || typeof input.apiKey === "string") &&
    (input.provisioningKey === undefined || typeof input.provisioningKey === "string")
  );
};

/**
 * Exposes API-related functionality to the renderer process
 */
export const apiFeature = {
  // No `getActiveProvider`: the channel behind it is gone. There is no single
  // active provider — every connected provider serves models at once, and a
  // request is routed by the composite ref it names. Ask `getProviderStates()`
  // instead, which answers for all providers in one round-trip.

  /**
   * Every provider's connection state in ONE round-trip: `configured`,
   * `apiKeySet`, `provisioningKeySet`, `modelCount`.
   *
   * Booleans and a count — never key material. There is deliberately no
   * channel that returns a decrypted key, a prefix, a suffix, a length, or a
   * masked form, and this method must never grow one.
   */
  getProviderStates: (): Promise<ProviderStates> =>
    ipcRenderer.invoke("get-provider-states"),

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
    setup: ProviderConnectInput,
  ): Promise<{ success: boolean; models?: Model[]; error?: Label }> => {
    if (!isProviderConnectInput(setup)) {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidSetup") };
    }
    const result = await ipcRenderer.invoke("fetch-provider-models", setup);
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Connect a provider: verify its credentials, store them, and install its
   * model list. Does **not** set a default model — that is `setSelectedModel`.
   *
   * `note` carries advice for a connect that succeeded with a caveat (Ollama
   * reachable but with nothing pulled), which is why it is separate from
   * `error`: the provider really is connected.
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
    // Fields are selected explicitly rather than spread. A `{ ...result }`
    // forwards whatever main happens to put on the object, so any field a
    // later handler edit adds — including one carrying credential material —
    // would cross to the renderer with no review and no failing test.
    return {
      success: result?.success === true,
      profile: result?.profile,
      note: asLabel(result?.note),
      error: asLabel(result?.error),
    };
  },

  /**
   * Disconnect a provider: delete its stored credentials, drop it from the
   * profile, and reset the model refs that named it.
   *
   * `cleared` is main's answer verbatim — it is what the confirmation warning
   * renders, so reshaping it here would make the warning describe something
   * other than what happened.
   */
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
   * Fetches models from every connected provider in one round-trip.
   *
   * `errors` is per provider: one provider being unreachable degrades that
   * group and leaves the rest usable, so callers must read it rather than
   * treating `success: true` as "everything refreshed".
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
   * Sets the profile-wide default model. Pass `""` to inherit the dynamic
   * default. Main stores the canonical composite ref, not the raw input.
   */
  setSelectedModel: async (
    modelId: string,
  ): Promise<{ success: boolean; error?: Label }> => {
    if (typeof modelId !== "string") {
      return { success: false, error: messageLabel("models.select.error.modelNotAvailableForProvider") };
    }
    const result = await ipcRenderer.invoke("set-selected-model", modelId);
    // Gated on success, matching connect/disconnect. `settings-updated` makes
    // every listener refetch with `refetch: true`, i.e. a full network fan-out
    // across every connected provider — firing that after main REJECTED the
    // ref means paying for it to learn nothing changed.
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
