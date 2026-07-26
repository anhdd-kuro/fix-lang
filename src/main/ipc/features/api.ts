/**
 * @file api.ts
 * @description IPC handlers for OpenAI API related functionality
 */
import { ipcMain } from "electron";
import { fetchAvailableModels, fetchModelsForProviders } from "~/main/ai.request";
import { reloadHotkeys } from "~/main/keybindings";
import { ollamaClient } from "~/main/llm";
import { checkModelCompatibility } from "~/main/llm/models/compatibility";
import { probeOllama } from "~/main/llm/models/discover";
import {
  findRecommendedModel,
  getRecommendedModels,
} from "~/main/llm/models/recommended";
import { messageLabel, textLabel } from "~/shared/i18n/message";
import { redactLogMessage } from "~/shared/logging";
import { resolveModelRef } from "~/shared/modelRef";
import {
  isModelForProvider,
  isProviderConfigured,
  isProviderId,
  modelsForProvider,
  PROVIDER_IDS,
  sanitizeEnabledProviders,
} from "~/shared/providers";
import {
  clearApiKey,
  getApiKey,
  hasApiKey,
  setApiKey,
} from "~/stores/apiKeyStore";
import {
  connectProviderToProfile,
  disconnectProviderFromProfile,
  getCurrentProfileId,
  getDefaultModelId,
  getProfileSetting,
  resetCurrentProfileSettings,
  updateProfileSetting,
  withoutProfileSecrets,
} from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import {
  clearProfileSecret,
  getProfileSecret,
  hasProfileSecret,
  secretKindsForProvider,
  setProfileSecret,
} from "~/stores/profileSecretStore";
import { exceptionLabel, wrapStoreResult } from "./ipcResultLabel";
import type { Label } from "~/shared/i18n/message";
import type { Model, ProviderId } from "~/shared/providers";

// Provider predicates come from `~/shared/providers`, not `~/stores/apiStore`'s
// re-export, so the apiStore mock every test here installs cannot stand in for
// the predicate under test.

const MASK_RUN = /\S*[*•·…]{2,}\S*/g;

/**
 * SECURITY: provider 401 bodies quote the submitted key back (`Incorrect API
 * key provided: sk-proj-abcd***WXYZ`), and these paths authenticate with the
 * STORED key — so provider error text is redacted before it reaches the
 * renderer. Best effort, not a proof.
 */
const providerErrorLabel = (error: unknown): Label =>
  textLabel(
    redactLogMessage(error instanceof Error ? error.message : String(error)).replace(
      MASK_RUN,
      "[REDACTED]",
    ),
  );

/**
 * SECURITY: booleans and a count only — never key material, in any masked,
 * prefixed or length-bearing form. A decrypted key must never reach the
 * renderer, which is also why no `get-api-key` channel exists.
 */
export type ProviderState = {
  /** In `enabledProviders`. `set-selected-model` and `get-cached-models` gate on this, not on `configured`. */
  connected: boolean;
  configured: boolean;
  apiKeySet: boolean;
  /** OpenRouter-only. */
  provisioningKeySet: boolean;
  modelCount: number;
};

export type ProviderStates = Record<ProviderId, ProviderState>;

/** No `modelId`: connecting a provider must not seed a default model over the user's existing choice. */
type ProviderConnectPayload = {
  provider: ProviderId;
  apiKey?: string;
  provisioningKey?: string;
};

export const parseProviderConnect = (raw: unknown): ProviderConnectPayload | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!isProviderId(value.provider)) return null;
  if (
    (value.apiKey !== undefined && typeof value.apiKey !== "string") ||
    (value.provisioningKey !== undefined && typeof value.provisioningKey !== "string")
  ) {
    return null;
  }
  return {
    provider: value.provider,
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

const enabledProviders = (): ProviderId[] =>
  sanitizeEnabledProviders(getProfileSetting("enabledProviders"));

// OpenRouter reads through `getApiKey()` for its pre-profile legacy fallback,
// so an upgrading user whose key is not migrated yet still gets a working fetch.
const providerApiKeys = async (
  providers: readonly ProviderId[],
): Promise<Partial<Record<ProviderId, string>>> => {
  const profileId = getCurrentProfileId();
  const entries = await Promise.all(
    providers.map(async (provider): Promise<[ProviderId, string]> => {
      if (!secretKindsForProvider(provider).includes("api")) return [provider, ""];
      if (provider === "openrouter") return [provider, (await getApiKey()) ?? ""];
      return [
        provider,
        profileId ? ((await getProfileSecret(profileId, provider, "api")) ?? "") : "",
      ];
    }),
  );
  return Object.fromEntries(entries) as Partial<Record<ProviderId, string>>;
};

const readProviderStates = async (): Promise<ProviderStates> => {
  const profileId = getCurrentProfileId();
  const enabled = enabledProviders();
  const cachedModels = getProfileSetting("models") || [];

  const entries = await Promise.all(
    PROVIDER_IDS.map(async (provider): Promise<[ProviderId, ProviderState]> => {
      const kinds = secretKindsForProvider(provider);
      const apiKeySet =
        profileId !== "" &&
        kinds.includes("api") &&
        (await hasProfileSecret(profileId, provider, "api"));
      const provisioningKeySet =
        profileId !== "" &&
        kinds.includes("provisioning") &&
        (await hasProfileSecret(profileId, provider, "provisioning"));
      const connected = enabled.includes(provider);
      return [
        provider,
        {
          connected,
          configured: isProviderConfigured(provider, {
            hasApiKey: apiKeySet,
            explicitlyEnabled: connected,
          }),
          apiKeySet,
          provisioningKeySet,
          modelCount: modelsForProvider(cachedModels, provider).length,
        },
      ];
    }),
  );

  return Object.fromEntries(entries) as ProviderStates;
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
      return { success: false, error: messageLabel("models.providerSetup.error.invalidApiKeyInput") };
    }
    try {
      const result = await setApiKey(raw);
      if (!result.success) return wrapStoreResult(result);

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
      return { success: false, error: exceptionLabel(error) };
    }
  });

  ipcMain.handle("has-api-key", async () => hasApiKey());

  ipcMain.handle("clear-api-key", async () => wrapStoreResult(await clearApiKey()));

  // No "get-active-provider": requests route by composite `<providerId>::<rawId>` ref.

  // SECURITY: booleans and a count only — must never grow a key-bearing field. See `ProviderState`.
  ipcMain.handle("get-provider-states", async (): Promise<ProviderStates> => {
    try {
      return await readProviderStates();
    } catch (error) {
      // All-false reports nothing as connected rather than inventing a connection.
      console.error("Error reading provider states:", error);
      return Object.fromEntries(
        PROVIDER_IDS.map((provider) => [
          provider,
          {
            connected: false,
            configured: false,
            apiKeySet: false,
            provisioningKeySet: false,
            modelCount: 0,
          },
        ]),
      ) as ProviderStates;
    }
  });

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

  // Fetching with a typed key never stores it and never connects the provider;
  // only `connect-provider` below commits the validated key + model cache.
  ipcMain.handle("fetch-provider-models", async (_event, raw: unknown) => {
    const payload = parseProviderConnect(raw);
    const profileId = getCurrentProfileId();
    if (!payload || !profileId) {
      return { success: false, error: messageLabel("models.providerSetup.error.invalidSetup") };
    }
    if (payload.provider !== "openrouter" && payload.provisioningKey?.trim()) {
      return {
        success: false,
        error: messageLabel("models.providerSetup.error.provisioningKeyOpenRouterOnly"),
      };
    }
    try {
      const apiKey = await getSetupApiKey(profileId, payload.provider, payload.apiKey);
      if (payload.provider !== "ollama" && !apiKey) {
        return {
          success: false,
          error: messageLabel("models.providerSetup.error.apiKeyRequiredFirst", {
            provider: payload.provider === "openai" ? "OpenAI" : "OpenRouter",
          }),
        };
      }
      // strict: true — a live-fetch failure (bad/revoked key) must surface as
      // an error here, never silently fall back to a stale cached list.
      const models = await fetchAvailableModels(apiKey, payload.provider, false, true);
      return { success: true, models };
    } catch (error) {
      return { success: false, error: providerErrorLabel(error) };
    }
  });

  // Never writes `selectedModel` or any preset/feature model — picking a
  // default is `set-selected-model`'s job alone.
  ipcMain.handle("connect-provider", async (_event, raw: unknown) => {
    const payload = parseProviderConnect(raw);
    const profileId = getCurrentProfileId();
    if (!payload || !profileId) {
      return {
        success: false,
        error: messageLabel("models.providerSetup.error.invalidSetup"),
      };
    }
    if (payload.provider !== "openrouter" && payload.provisioningKey?.trim()) {
      return {
        success: false,
        error: messageLabel("models.providerSetup.error.provisioningKeyOpenRouterOnly"),
      };
    }

    try {
      let models: Model[];
      let note: Label | undefined;

      if (payload.provider === "ollama") {
        // `probeOllama`, not `fetchAvailableModels`: the latter returns `[]`
        // for both "daemon down" and "daemon up with nothing pulled".
        const probe = await probeOllama();
        if (!probe.reachable) {
          return {
            success: false,
            error: messageLabel("settings.general.providers.ollama.unreachable"),
          };
        }
        models = probe.models;
        if (models.length === 0) {
          // Reachable but empty connects successfully, with advice.
          note = messageLabel("settings.general.providers.ollama.noModels");
        }
      } else {
        const apiKey = await getSetupApiKey(profileId, payload.provider, payload.apiKey);
        if (!apiKey) {
          return {
            success: false,
            error: messageLabel("models.providerSetup.error.apiKeyRequired", {
              provider: payload.provider === "openai" ? "OpenAI" : "OpenRouter",
            }),
          };
        }

        // Validate the key before writing it: non-persistent and strict, so a
        // revoked key cannot pass on stale models cached by an earlier connect.
        models = await fetchAvailableModels(apiKey, payload.provider, false, true);

        if (payload.apiKey?.trim()) {
          const result = await setProfileSecret(
            profileId,
            payload.provider,
            "api",
            payload.apiKey,
          );
          if (!result.success) return wrapStoreResult(result);
        } else if (!(await hasProfileSecret(profileId, payload.provider, "api"))) {
          return {
            success: false,
            error: messageLabel("models.providerSetup.error.apiKeyNotVerified"),
          };
        }
        if (payload.provider === "openrouter" && payload.provisioningKey?.trim()) {
          const result = await setProfileSecret(
            profileId,
            "openrouter",
            "provisioning",
            payload.provisioningKey,
          );
          if (!result.success) return wrapStoreResult(result);
        }
      }

      // Bound to the captured `profileId`: the profile-switch hotkey can land
      // during the fetch above, and the key was written to THAT profile.
      const profile = connectProviderToProfile(profileId, payload.provider, models);
      if (!profile) {
        return {
          success: false,
          error: messageLabel("models.providerSetup.error.activeProfileNotFound"),
        };
      }
      // SECURITY: `SettingsStore` still declares the deprecated plaintext
      // `apiKey`, so an unmigrated profile must be stripped before it crosses.
      return {
        success: true,
        profile: withoutProfileSecrets(profile),
        ...(note ? { note } : {}),
      };
    } catch (error) {
      return { success: false, error: providerErrorLabel(error) };
    }
  });

  ipcMain.handle("disconnect-provider", async (_event, raw: unknown) => {
    if (!isProviderId(raw)) {
      return {
        success: false,
        error: messageLabel("models.providerSetup.error.invalidSetup"),
      };
    }
    const profileId = getCurrentProfileId();
    if (!profileId) {
      return {
        success: false,
        error: messageLabel("models.providerSetup.error.activeProfileNotFound"),
      };
    }

    try {
      // Every slot is attempted even when one fails: a sequential loop bailing
      // on the first failure would strand OpenRouter's provisioning key.
      const results = await Promise.all(
        secretKindsForProvider(raw).map((kind) =>
          clearProfileSecret(profileId, raw, kind),
        ),
      );
      const failedClear = results.find((result) => !result.success);
      if (failedClear) {
        // Stays connected on purpose: disconnecting with a key still on disk
        // would make the confirmation copy a lie. Retrying is safe.
        return wrapStoreResult(failedClear);
      }

      // Bound to the captured `profileId`: a profile switch during the clear
      // above must not clear a different profile's model refs. Null therefore
      // means that profile is gone, and its deleted keys are moot.
      const outcome = disconnectProviderFromProfile(profileId, raw);
      if (!outcome) {
        return {
          success: false,
          error: messageLabel("models.providerSetup.error.activeProfileNotFound"),
        };
      }
      return {
        success: true,
        profile: withoutProfileSecrets(outcome.profile),
        cleared: outcome.cleared,
      };
    } catch (error) {
      return { success: false, error: exceptionLabel(error) };
    }
  });

  // Model handling. `refetch` comes from the renderer: falsy (a plain
  // ModelSelect mount / tab open) may be served from the fresh cache, while
  // `true` (the ↻ refresh button, the `settings-updated` broadcast) always
  // reaches the provider.
  ipcMain.handle("fetch-ai-models", async (_event, refetch?: boolean) => {
    try {
      const providers = enabledProviders();
      const keys = await providerApiKeys(providers);
      const { models, errors } = await fetchModelsForProviders(
        providers,
        keys,
        refetch === true,
      );

      return {
        success: true,
        // Filter on the way out only: `fetchModelsForProviders` deliberately
        // merges every provider's cached slice so the store write stays whole.
        models: models.filter((model) =>
          providers.some((provider) => isModelForProvider(model, provider)),
        ),
        // SECURITY: provider failure text can quote back a key read from disk.
        errors: Object.fromEntries(
          Object.entries(errors).map(([provider, message]) => [
            provider,
            redactLogMessage(message).replace(MASK_RUN, "[REDACTED]"),
          ]),
        ) as Partial<Record<ProviderId, string>>,
      };
    } catch (error) {
      console.error(
        "Error fetching models:",
        redactLogMessage(error instanceof Error ? error.message : String(error)),
      );
      return { success: false, error: providerErrorLabel(error) };
    }
  });

  // Fallback to cached models if API call fails. Restricted to connected
  // providers, so a stale or legacy untagged entry cannot offer the picker a
  // model no key can serve.
  ipcMain.handle("get-cached-models", () => {
    const providers = enabledProviders();
    return (getProfileSetting("models") || []).filter((model) =>
      providers.some((provider) => isModelForProvider(model, provider)),
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
    return wrapStoreResult(result);
  });

  // `""` clears the explicit choice. Otherwise the stored value is the
  // canonical ref `resolveModelRef` returned, never the caller's raw string: a
  // bare `"gpt-4o"` would route by PROVIDER_ORDER scan and bill whichever
  // provider lists that id first.
  ipcMain.handle("set-selected-model", async (_event, raw: unknown) => {
    try {
      const requested = typeof raw === "string" ? raw.trim() : "";
      if (typeof raw !== "string") {
        return {
          success: false,
          error: messageLabel("models.select.error.modelNotAvailableForProvider"),
        };
      }

      if (requested === "") {
        const result = updateProfileSetting("selectedModel", "");
        if (!result.success) return wrapStoreResult(result);
        return { success: true };
      }

      const models = getProfileSetting("models") || [];
      const resolution = resolveModelRef(requested, models);
      if (!resolution || !enabledProviders().includes(resolution.provider)) {
        return {
          success: false,
          error: messageLabel("models.select.error.modelNotAvailableForProvider"),
        };
      }

      const result = updateProfileSetting("selectedModel", resolution.ref);
      if (!result.success) return wrapStoreResult(result);

      return { success: true };
    } catch (error) {
      console.error("Error setting selected model:", error);
      return { success: false, error: exceptionLabel(error) };
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
        return {
          success: false,
          error: messageLabel("models.select.error.unsupportedFeatureModel"),
        };
      }
      const current = getProfileSetting("settingsPromptGen");
      const result = updateProfileSetting("settingsPromptGen", {
        ...current,
        model,
      });
      if (!result.success) return wrapStoreResult(result);
      console.log(`Set ${feature} model to: ${model}`);
      return { success: true };
    } catch (error) {
      console.error("Error setting feature model:", error);
      return { success: false, error: exceptionLabel(error) };
    }
  });

  // Local LLM model management handlers
  ipcMain.handle("open-model-manager", async () => {
    try {
      // The model manager is now implemented as a React component in the renderer
      return { success: true };
    } catch (error) {
      console.error("Error opening model manager:", error);
      return { success: false, error: exceptionLabel(error) };
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
          error: messageLabel("models.manager.error.modelNotFound", { modelName }),
        };
      }

      const compatibility = await checkModelCompatibility(model);
      return {
        success: true,
        compatibility,
      };
    } catch (error) {
      console.error("Error checking model compatibility:", error);
      return { success: false, error: exceptionLabel(error) };
    }
  });
};
