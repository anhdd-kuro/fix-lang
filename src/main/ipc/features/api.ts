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
  connectProviderToActiveProfile,
  disconnectProviderFromActiveProfile,
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

/**
 * `isProviderId` / `isModelForProvider` / `modelsForProvider` are imported
 * from `~/shared/providers`, not from `~/stores/apiStore`'s re-export. Both
 * resolve to the same functions, but the direct import keeps this module's
 * provider predicates out of the `~/stores/apiStore` mock surface every test
 * in this directory installs — a hand-rolled stand-in for the predicate under
 * refactor tests the stand-in, not the code.
 */

/**
 * A run of mask characters plus whatever is glued to it, e.g. the `***WXYZ`
 * tail OpenAI leaves behind after `redactLogMessage` has eaten the `sk-`
 * prefix out of `sk-proj-abcd***WXYZ`.
 */
const MASK_RUN = /\S*[*•·…]{2,}\S*/g;

/**
 * Provider-authored error text, made safe to hand the renderer.
 *
 * A provider's own 401 body can quote the key back at you: OpenAI answers
 * `Incorrect API key provided: sk-proj-abcd***WXYZ.` — a prefix AND a suffix
 * of a key the renderer never typed, because these paths authenticate with
 * the STORED key. The text is still worth showing ("401 Unauthorized",
 * "model not found"), so it is redacted rather than swallowed:
 * `redactLogMessage` kills the `sk-`/`or-` prefix and the rule above kills
 * what the mask character left behind.
 *
 * **Best effort, not a proof.** A provider that echoed only an unmasked tail
 * with no recognizable prefix would still get through. Swallowing the text
 * outright would be airtight and useless; this is the trade. `exceptionLabel`
 * is deliberately not changed — it is shared with `profiles.ts`, whose errors
 * are filesystem/store text that never carries a credential.
 */
const providerErrorLabel = (error: unknown): Label =>
  textLabel(
    redactLogMessage(error instanceof Error ? error.message : String(error)).replace(
      MASK_RUN,
      "[REDACTED]",
    ),
  );

/**
 * One provider's state, as answered by `get-provider-states`.
 *
 * **Booleans and a count only — never key material.** There is deliberately
 * no `get-api-key` channel and no masked/prefixed/length-bearing form of a
 * stored secret anywhere in this shape: a decrypted key must never reach the
 * renderer. Pinned by a test that asserts on the serialized JSON of a
 * response for a profile that has keys stored.
 */
export type ProviderState = {
  /**
   * The user has connected this provider on this profile — i.e. it is in
   * `enabledProviders`.
   *
   * Distinct from `configured`, and the distinction matters: a provider whose
   * key is still on disk but which has been disconnected is
   * `configured: true, connected: false`. `set-selected-model` and
   * `get-cached-models` both gate on **connected**, so a UI that read only
   * `configured` would offer models the store then refuses.
   */
  connected: boolean;
  /** Ready to serve requests — `isProviderConfigured`'s answer. */
  configured: boolean;
  /** An API key is on disk for this profile/provider. Never the key itself. */
  apiKeySet: boolean;
  /** OpenRouter-only. Never the key itself. */
  provisioningKeySet: boolean;
  /** How many cached models this provider currently contributes. */
  modelCount: number;
};

/** All providers' state in one round-trip. */
export type ProviderStates = Record<ProviderId, ProviderState>;

/**
 * The payload of `connect-provider`.
 *
 * **No `modelId`.** The key card and the model picker are separate surfaces:
 * connecting a provider installs its model list and must not seed a default
 * model, because doing so silently overwrote whatever the user had already
 * chosen from another provider.
 */
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

/** The active profile's connected providers, sanitized and ordered. */
const enabledProviders = (): ProviderId[] =>
  sanitizeEnabledProviders(getProfileSetting("enabledProviders"));

/**
 * The API keys for the given providers, keyed by provider.
 *
 * OpenRouter reads through `apiKeyStore.getApiKey()` rather than
 * `getProfileSecret` directly: that helper carries the pre-profile legacy
 * fallback, so an upgrading user whose key has not been migrated into a
 * profile yet still gets a working fetch.
 */
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

/**
 * Build every provider's state. Module scope, not a closure inside
 * `registerApiHandlers`, so the handler's catch below reads as an ordinary
 * call rather than a forward reference into its own enclosing scope.
 */
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

  // No "get-active-provider": there is no single active provider any more.
  // Every connected provider serves models simultaneously and a request is
  // routed by the composite `<providerId>::<rawId>` ref it names, so a channel
  // answering "which one is active?" can only lie. Use "get-provider-states".

  /**
   * Every provider's state in ONE round-trip.
   *
   * Returns booleans and a count. It must never grow a field carrying key
   * material — not the key, not a prefix/suffix, not a length, not a masked
   * form. See `ProviderState`.
   */
  ipcMain.handle("get-provider-states", async (): Promise<ProviderStates> => {
    try {
      return await readProviderStates();
    } catch (error) {
      // Nothing on this path throws today (`hasProfileSecret` swallows), but
      // an unhandled rejection here would surface in the renderer as a bare
      // IPC failure with no state at all. All-false is the safe answer: it
      // reports nothing as connected rather than inventing a connection.
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

  // Provider setup is staged by the General settings screen. Fetching with a
  // typed key never stores it and never connects the provider; only
  // `connect-provider` below commits the validated key + model cache.
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

  /**
   * Connect one provider: verify it answers, store the supplied credentials,
   * and install its model list on the active profile.
   *
   * **It never writes `selectedModel` or any preset/feature model.** The
   * handler this replaces (`apply-provider-setup`) took a `modelId` and
   * committed it as the profile default, which meant connecting a second
   * provider silently retargeted every model choice the user had already
   * made. Picking a default is now `set-selected-model`'s job alone.
   */
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
        // `probeOllama`, not `fetchAvailableModels`: the latter swallows the
        // connection error and returns `[]`, so "the daemon isn't running"
        // and "the daemon is running with nothing pulled" become the same
        // answer — and those two need opposite advice.
        const probe = await probeOllama();
        if (!probe.reachable) {
          return {
            success: false,
            error: messageLabel("settings.general.providers.ollama.unreachable"),
          };
        }
        models = probe.models;
        if (models.length === 0) {
          // Reachable but empty is a SUCCESS with advice, not a failure: the
          // provider is genuinely connected, it just has nothing to offer yet.
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

        // Validate the key before writing it or touching the active profile.
        // Non-persistent (the connect below is the single write) and strict,
        // so an invalid/revoked key cannot pass validation just because stale
        // models are still cached from a prior successful connect.
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

      const profile = connectProviderToActiveProfile(payload.provider, models);
      if (!profile) {
        return {
          success: false,
          error: messageLabel("models.providerSetup.error.activeProfileNotFound"),
        };
      }
      // `withoutProfileSecrets`, not the raw profile: `SettingsStore` still
      // declares the deprecated plaintext `apiKey`, and a profile the legacy
      // migration has not scrubbed yet would carry a decrypted key straight
      // across to the renderer. The narrow stripper is the right one here —
      // this value is displayed, not written back, but card 07 needs the
      // model state it keeps.
      return {
        success: true,
        profile: withoutProfileSecrets(profile),
        ...(note ? { note } : {}),
      };
    } catch (error) {
      return { success: false, error: providerErrorLabel(error) };
    }
  });

  /**
   * Disconnect one provider: delete every credential slot it has, drop it
   * from `enabledProviders`, drop its model slice, and reset the model refs
   * that named it.
   *
   * `cleared` is returned exactly as the store produced it — card 07's inline
   * warning renders it, and a handler that "helpfully" reshaped it would make
   * the warning describe something other than what just happened.
   */
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
      // Slots are derived from the provider tables, never branched on by
      // hand: a provider added to PROVIDER_IDS inherits the right ones, and a
      // missed slot leaves a disconnected provider's key on disk.
      //
      // EVERY slot is attempted even when an earlier one fails (`Promise.all`
      // over calls already in flight), mirroring `clearProfileSecrets`: a
      // sequential loop that returned on the first failure would strand
      // OpenRouter's provisioning key whenever the API key delete failed.
      const results = await Promise.all(
        secretKindsForProvider(raw).map((kind) =>
          clearProfileSecret(profileId, raw, kind),
        ),
      );
      const failedClear = results.find((result) => !result.success);
      if (failedClear) {
        // The provider stays connected on purpose. The confirmation copy
        // promises "the stored API key will be deleted"; disconnecting after
        // failing to delete it would make that promise false. Retrying is
        // safe — `clearProfileSecret` is `rm --force`, so the slots that DID
        // clear succeed again as no-ops.
        return wrapStoreResult(failedClear);
      }

      const outcome = disconnectProviderFromActiveProfile(raw);
      if (!outcome) {
        return {
          success: false,
          error: messageLabel("models.providerSetup.error.activeProfileNotFound"),
        };
      }
      // `cleared` is passed through by identity — card 07's warning renders
      // exactly this. The profile is secret-stripped for the same reason as
      // in `connect-provider`.
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
  //
  // Fans out across EVERY connected provider in one call and returns the
  // per-provider `errors` map alongside the merged list, so one provider
  // being down degrades that group instead of failing the whole picker.
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
        // `fetchModelsForProviders` merges the previously cached slice for
        // EVERY provider in PROVIDER_ORDER, not just the ones it was asked
        // for, so that an unasked provider's cache survives the write. That
        // is right for the cache and wrong for the picker: unfiltered, a
        // disconnected provider's stale slice reappears here and contradicts
        // `get-cached-models`, which filters. Filter on the way out only —
        // the store write inside stays whole.
        models: models.filter((model) =>
          providers.some((provider) => isModelForProvider(model, provider)),
        ),
        // A provider's own failure text can quote the key back; these keys
        // came from disk, so the renderer has never seen them.
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

  // Fallback to cached models if API call fails. Restricted to CONNECTED
  // providers: a disconnect drops the provider's slice, but a profile that
  // predates the drop (or a legacy untagged entry) can still leave models
  // behind, and surfacing those in the picker offers a model no key can serve.
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

  /**
   * Set the profile-wide default model.
   *
   * Three rules, in order:
   *
   * 1. `""` is the **inherit** sentinel and is always accepted — it clears the
   *    explicit choice so `getDefaultModelId` falls back to the dynamic pick.
   * 2. Otherwise the ref must resolve against the cached models, and the
   *    provider it resolves to must currently be connected. There is no
   *    "active provider" to compare against any more.
   * 3. **The stored value is the canonical ref the resolve returned, never the
   *    raw input.** A renderer that sends a bare `"gpt-4o"` would otherwise
   *    de-migrate the field: the stored value stops naming a provider and
   *    routing falls back to the `PROVIDER_ORDER` scan, which bills whichever
   *    provider happens to list that id first. Two providers serving the same
   *    id is exactly the ambiguity composite refs exist to remove.
   */
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
