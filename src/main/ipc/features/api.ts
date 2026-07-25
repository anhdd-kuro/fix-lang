/**
 * @file api.ts
 * @description IPC handlers for OpenAI API related functionality
 */
import { ipcMain } from "electron";
import { fetchAvailableModels, getActiveProvider } from "~/main/ai.request";
import { reloadHotkeys } from "~/main/keybindings";
import { ollamaClient } from "~/main/llm";
import { checkModelCompatibility } from "~/main/llm/models/compatibility";
import {
  findRecommendedModel,
  getRecommendedModels,
} from "~/main/llm/models/recommended";
import {
  clearApiKey,
  getApiKey,
  hasApiKey,
  setApiKey,
} from "~/stores/apiKeyStore";
import {
  commitActiveProfileProviderSetup,
  getCurrentProfileId,
  getDefaultModelId,
  getProfileSetting,
  isModelForProvider,
  isProviderId,
  resetCurrentProfileSettings,
  updateProfileSetting,
} from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import {
  getProfileSecret,
  hasProfileSecret,
  setProfileSecret,
} from "~/stores/profileSecretStore";
import type { ProviderId } from "~/stores/apiStore";

type ProviderSetupPayload = {
  provider: ProviderId;
  modelId: string;
  apiKey?: string;
  provisioningKey?: string;
};

export const parseProviderSetup = (raw: unknown): ProviderSetupPayload | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!isProviderId(value.provider) || typeof value.modelId !== "string") {
    return null;
  }
  if (
    (value.apiKey !== undefined && typeof value.apiKey !== "string") ||
    (value.provisioningKey !== undefined && typeof value.provisioningKey !== "string")
  ) {
    return null;
  }
  return {
    provider: value.provider,
    modelId: value.modelId.trim(),
    ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    ...(typeof value.provisioningKey === "string"
      ? { provisioningKey: value.provisioningKey }
      : {}),
  };
};

const getSetupApiKey = async (
  profileId: string,
  provider: ProviderId,
  suppliedKey?: string,
): Promise<string> => {
  if (provider === "ollama") return "";
  if (suppliedKey?.trim()) return suppliedKey.trim();
  return (await getProfileSecret(profileId, provider, "api")) ?? "";
};

/**
 * Registers API-related IPC handlers
 */
export const registerApiHandlers = (): void => {
  // ---------------------------------------------------------------------------
  // API key — safeStorage-backed. No "get-api-key" by design: the decrypted key
  // never crosses to the renderer. The UI tracks only a boolean set/not-set
  // state via has-api-key, mirroring the provisioning key pattern.
  // ---------------------------------------------------------------------------

  ipcMain.handle("set-api-key", async (_event, raw: unknown) => {
    if (typeof raw !== "string") {
      return { success: false, error: "Invalid key" };
    }
    try {
      const result = await setApiKey(raw);
      if (!result.success) return result;

      // Refetch models in the background using the newly stored key.
      void getApiKey()
        .then((key) => (key ? fetchAvailableModels(key, "openrouter") : null))
        .then((models) => {
          if (models) {
            console.log(`Refetched ${models.length} models after API key save`);
          }
        })
        .catch((error) => {
          console.error("Failed to refetch models after API key save:", error);
        });

      return result;
    } catch (error) {
      console.error("Error saving API key:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("has-api-key", async () => hasApiKey());

  ipcMain.handle("clear-api-key", async () => clearApiKey());

  ipcMain.handle("get-active-provider", () => getActiveProvider());

  ipcMain.handle("get-provider-secret-status", async (_event, raw: unknown) => {
    if (!isProviderId(raw)) return { apiKeySet: false, provisioningKeySet: false };
    const profileId = getCurrentProfileId();
    if (!profileId) return { apiKeySet: false, provisioningKeySet: false };
    return {
      apiKeySet:
        raw === "ollama" ? false : await hasProfileSecret(profileId, raw, "api"),
      provisioningKeySet:
        raw === "openrouter" &&
        (await hasProfileSecret(profileId, "openrouter", "provisioning")),
    };
  });

  // Provider setup is staged by the General settings screen. Fetching with a
  // typed key never stores it or changes the active provider; only the apply
  // handler below commits the validated provider/model/cache together.
  ipcMain.handle("fetch-provider-models", async (_event, raw: unknown) => {
    const payload = parseProviderSetup(raw);
    const profileId = getCurrentProfileId();
    if (!payload || !profileId) {
      return { success: false, error: "Invalid provider setup" };
    }
    if (payload.provider !== "openrouter" && payload.provisioningKey?.trim()) {
      return { success: false, error: "Only OpenRouter supports a provisioning key" };
    }
    try {
      const apiKey = await getSetupApiKey(profileId, payload.provider, payload.apiKey);
      if (payload.provider !== "ollama" && !apiKey) {
        return { success: false, error: `Save or enter an ${payload.provider === "openai" ? "OpenAI" : "OpenRouter"} API key first` };
      }
      // strict: true — a live-fetch failure (bad/revoked key) must surface as
      // an error here, never silently fall back to a stale cached list.
      const models = await fetchAvailableModels(apiKey, payload.provider, false, true);
      return { success: true, models };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("apply-provider-setup", async (_event, raw: unknown) => {
    const payload = parseProviderSetup(raw);
    const profileId = getCurrentProfileId();
    if (!payload || !profileId || !payload.modelId) {
      return { success: false, error: "Choose a provider and default model" };
    }
    if (payload.provider !== "openrouter" && payload.provisioningKey?.trim()) {
      return { success: false, error: "Only OpenRouter supports a provisioning key" };
    }

    try {
      const apiKey = await getSetupApiKey(profileId, payload.provider, payload.apiKey);
      if (payload.provider !== "ollama" && !apiKey) {
        return { success: false, error: `An ${payload.provider === "openai" ? "OpenAI" : "OpenRouter"} API key is required` };
      }

      // Validate the model before writing credentials or touching the active
      // profile. fetchAvailableModels is intentionally non-persistent here,
      // and strict so an invalid/revoked key cannot pass validation just
      // because stale models are still cached from a prior successful setup.
      const models = await fetchAvailableModels(apiKey, payload.provider, false, true);
      const selectedModel = models.find(
        (model) => model.id === payload.modelId && isModelForProvider(model, payload.provider),
      );
      if (!selectedModel) {
        return { success: false, error: "Choose a model available from the selected provider" };
      }

      if (payload.provider !== "ollama" && payload.apiKey?.trim()) {
        const result = await setProfileSecret(profileId, payload.provider, "api", payload.apiKey);
        if (!result.success) return result;
      } else if (payload.provider !== "ollama" && !(await hasProfileSecret(profileId, payload.provider, "api"))) {
        return { success: false, error: "API key could not be verified" };
      }
      if (payload.provider === "openrouter" && payload.provisioningKey?.trim()) {
        const result = await setProfileSecret(
          profileId,
          "openrouter",
          "provisioning",
          payload.provisioningKey,
        );
        if (!result.success) return result;
      }

      const profile = commitActiveProfileProviderSetup(
        payload.provider,
        selectedModel.id,
        models,
      );
      if (!profile) return { success: false, error: "Active profile not found" };
      return { success: true, profile };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Model handling
  ipcMain.handle("fetch-ai-models", async () => {
    try {
      const provider = getActiveProvider();
      const profileId = getCurrentProfileId();
      const apiKey =
        provider === "openrouter"
          ? ((await getApiKey()) ?? "")
          : provider === "openai" && profileId
            ? ((await getProfileSecret(profileId, "openai", "api")) ?? "")
            : "";
      const models = await fetchAvailableModels(apiKey, provider);

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
    return (getProfileSetting("models") || []).filter((model) =>
      isModelForProvider(model, getActiveProvider()),
    );
  });

  ipcMain.handle("get-selected-model", () => {
    // Explicit global selection, else dynamic latest GPT mini from the list.
    return getDefaultModelId();
  });

  ipcMain.handle("reset-profile-settings", () => {
    const result = resetCurrentProfileSettings();
    if (result.success) {
      // Also restore the global keybindings (promptGen / profileSwitch) to
      // defaults, then re-register all globals + restored preset hotkeys.
      keybindingStore.resetKeyBindings();
      reloadHotkeys();
    }
    return result;
  });

  ipcMain.handle("set-selected-model", async (_event, modelId) => {
    try {
      console.log(`[DEBUG IPC] Setting selected model via IPC to: ${modelId}`);

      // Sanity check - a global selection can only use the active provider.
      const models = getProfileSetting("models") || [];
      const model = models.find((m) => m.id === modelId);
      console.log(`[DEBUG IPC] Model found in registry: ${!!model}`);
      if (model) {
        console.log(
          `[DEBUG IPC] Model details: local=${!!model.local}, name=${model.name}`,
        );
      }

      if (!model || !isModelForProvider(model, getActiveProvider())) {
        return { success: false, error: "Model is not available from the active provider" };
      }
      const result = updateProfileSetting("selectedModel", modelId);
      if (!result.success) return result;

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
    if (feature === "settingsPromptGen") {
      return getProfileSetting("settingsPromptGen").model || getDefaultModelId();
    }
    return getDefaultModelId();
  });

  ipcMain.handle("set-feature-model", async (_event, feature, model) => {
    try {
      if (feature !== "settingsPromptGen" || typeof model !== "string") {
        return { success: false, error: "Unsupported feature model setting" };
      }
      const current = getProfileSetting("settingsPromptGen");
      const result = updateProfileSetting("settingsPromptGen", {
        ...current,
        model,
      });
      if (!result.success) return result;
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
            compatibility.issues.join(", "),
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
