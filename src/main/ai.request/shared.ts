/**
 * @file shared.ts
 * @description Cross-provider AI-request concerns: the model cache and its
 * freshness policy, model-list dispatch, and `makeAIRequest`'s routing.
 *
 * Each provider's own fetch/request implementation lives in
 * `~/main/llm/providers/<id>/`, reached THROUGH the capability registry — adding a
 * provider is a folder plus a registry entry, not another branch here. The moved
 * symbols are re-exported at the bottom so existing call sites and tests keep
 * importing them from this module.
 */
import { resolveLmStudioEndpoint } from "~/features/providers/shared/lmstudioEndpoint";
import { parseModelRef, resolveModelRef } from "~/features/providers/shared/modelRef";
import { describeKeyShape, findKeyShapeMismatch } from "~/features/providers/shared/providerKeyShapes";
import {
  modelsForProvider,
  PROVIDER_ORDER,
  PROVIDER_REQUIRES_API_KEY,
} from "~/features/providers/shared/providers";
import {
  apiStore,
  getDefaultModelId,
  getProfileSetting,
  getProviderEndpoint,
  isModelForProvider,
  updateProfileSetting,
} from "~/features/providers/store/apiStore";
import { mainT } from "~/main/i18n";
import { probeOllama } from "~/main/llm/models/discover";
import { providerCapabilities } from "~/main/llm/providers";
import { probeLmStudio } from "~/main/llm/providers/lmstudio/client";
import { logger } from "~/main/logging/logService";
import { notifyRequestError } from "~/main/notifications/error";
import type { AIRequestOptions, CoreMessage } from "./requestTypes";
import type { HistorySessionData } from "~/features/history/shared/historySession";
import type { TKey } from "~/features/i18n/shared/translate";
import type { Model, ProviderId } from "~/features/providers/store/apiStore";

const PROVIDER_NAME_KEYS = {
  openai: "models.select.provider.openai",
  openrouter: "models.select.provider.openrouter",
  ollama: "models.select.provider.ollama",
  lmstudio: "models.select.provider.lmstudio",
  bedrock: "models.select.provider.bedrock",
} as const satisfies Record<ProviderId, TKey>;

const isCachedForProvider = isModelForProvider;

/** Active-profile cache; legacy global storage is read only for old installs. */
const getStoredModels = (): Model[] =>
  getProfileSetting("models") || (apiStore.get("models") as Model[]) || [];

const cacheModelsForProvider = (provider: ProviderId, models: Model[]): void => {
  const retained = getStoredModels().filter(
    (model) => !isCachedForProvider(model, provider),
  );
  updateProfileSetting("models", [
    ...retained,
    ...models.map((model) => ({ ...model, provider: model.provider ?? provider })),
  ]);
};

const sortModels = (models: Model[]): Model[] =>
  [...models].sort((a, b) => {
    const byCreated = b.created - a.created;
    if (byCreated !== 0) return byCreated;
    const byIdLength = a.id.length - b.id.length;
    return byIdLength !== 0 ? byIdLength : a.id.localeCompare(b.id);
  });

/**
 * Main-process-only freshness record: when a GENUINE live provider fetch last
 * succeeded, per provider. Never persisted — deliberately empty at app launch
 * so the first display fetch after a launch always hits the provider, and only
 * later tab opens within the TTL are served free from the profile cache.
 *
 * Stamped ONLY on a real provider round-trip. A `fetchAvailableModels` call
 * that just echoed the cache back (no API key) or fell back to the cache after
 * an error must NOT mark the provider as fresh.
 */
const lastLiveFetchAt = new Map<ProviderId, number>();

/** How long a live-fetched model list may back display reads. */
export const MODEL_DISPLAY_CACHE_TTL_MS = 10 * 60 * 1000;

type ProviderFetch = {
  models: Model[];
  /**
   * Writing `[]` is only safe when discovery REACHED the provider: empty then
   * means the user removed everything. Every other empty result may be a
   * failure, and must leave the cached slice alone.
   */
  emptyMeansRemoved: boolean;
};

/**
 * Fetch models for exactly one provider. Direct OpenAI models deliberately do
 * not receive OpenRouter price fields, preventing fabricated cost estimates.
 *
 * `strict` governs whether a live-fetch failure is allowed to fall back to
 * the cache. Background/display callers (e.g. the periodic model refresh)
 * want resilience and should leave this false. Provider-setup validation
 * (apply/fetch in the staged General settings flow) MUST pass `strict: true`
 * for openai/openrouter — otherwise a stale-but-cached model list lets an
 * invalid or revoked key silently pass validation, deferring the real
 * failure to request time. Ollama never requires a key, so it always keeps
 * the resilient cache-fallback behavior regardless of `strict`.
 */
/**
 * Removes the exact key from provider error text before it is logged. The
 * shared redaction already strips `sk-…` forms and masked echoes, but a key with
 * no recognizable prefix (LM Studio's local key) would match none of them — and
 * a 401 body is written by the provider, not by us. Short values are left alone:
 * splitting on two characters would shred the message without protecting a
 * credential worth protecting.
 */
const withoutKeyEcho = (text: string, apiKey: string): string => {
  const key = apiKey.trim();
  return key.length >= 6 ? text.split(key).join("[REDACTED]") : text;
};

/**
 * One line per model-list fetch, carrying the key's SHAPE label and never the
 * key. A provider that rejects the stored request key looks identical to a
 * provider that is down until this says which key shape was presented.
 */
const logModelFetch = (
  provider: ProviderId,
  apiKey: string,
  outcome: { ok: boolean; liveFetch?: boolean; modelCount?: number; error?: string },
): void => {
  const context = {
    provider,
    keyPresent: apiKey.trim().length > 0,
    ...(apiKey.trim() ? { keyShape: describeKeyShape(apiKey) } : {}),
    ...(apiKey.trim() && findKeyShapeMismatch(provider, "api", apiKey)
      ? { keyBelongsToAnotherProvider: true }
      : {}),
    ...(outcome.liveFetch !== undefined ? { liveFetch: outcome.liveFetch } : {}),
    ...(outcome.modelCount !== undefined ? { modelCount: outcome.modelCount } : {}),
    // Two passes before this text is persisted: the exact key is removed here,
    // and `redactLogMessage` strips masked echoes and any other `sk-…` form.
    ...(outcome.error !== undefined
      ? { failure: withoutKeyEcho(outcome.error, apiKey) }
      : {}),
  };

  if (outcome.ok) {
    logger.debug("provider.models", "Model list fetched", context);
    return;
  }
  logger.warn("provider.models", "Model list fetch failed", context);
};

const fetchProviderModels = async (
  apiKey: string,
  provider: ProviderId,
  persistCache: boolean,
  strict: boolean,
): Promise<ProviderFetch> => {
  const cachedModels = getStoredModels();
  const cachedForProvider = cachedModels.filter((model) =>
    isCachedForProvider(model, provider),
  );

  try {
    let models: Model[];
    let liveFetch = true;
    let emptyMeansRemoved = false;
    if (provider === "ollama") {
      // `probeOllama`, not `getLocalModels`: the latter answers `[]` for both a
      // down daemon and a daemon with nothing pulled.
      const probe = await probeOllama();
      models = probe.models;
      liveFetch = probe.reachable;
      emptyMeansRemoved = probe.reachable;
      if (!probe.reachable) {
        console.error("Error fetching ollama models:", probe.error);
      }
    } else if (provider === "lmstudio") {
      const endpoint = resolveLmStudioEndpoint(getProviderEndpoint("lmstudio"));
      const probe = await probeLmStudio({
        endpoint,
        apiKey: apiKey || undefined,
      });
      models = probe.models;
      liveFetch = probe.reachable;
      emptyMeansRemoved = probe.reachable;
      if (!probe.reachable) {
        console.error("Error fetching lmstudio models:", probe.error);
      }
    } else if (!apiKey) {
      console.log(`No ${provider} API key provided; using cached models`);
      models = cachedForProvider;
      // Cache read-through, not a provider round-trip — must not look "fresh".
      liveFetch = false;
    } else {
      const fetchModels = providerCapabilities(provider).fetchModels;
      if (!fetchModels) {
        throw new Error(`Unsupported provider: ${provider}`);
      }
      models = await fetchModels(apiKey);
    }

    if (liveFetch) {
      lastLiveFetchAt.set(provider, Date.now());
    }
    const sortedModels = sortModels(models);
    if (persistCache && (sortedModels.length > 0 || emptyMeansRemoved)) {
      cacheModelsForProvider(provider, sortedModels);
    }
    logModelFetch(provider, apiKey, {
      ok: true,
      liveFetch,
      modelCount: sortedModels.length,
    });
    return { models: sortedModels, emptyMeansRemoved };
  } catch (error) {
    console.error(`Error fetching ${provider} models:`, error);
    logModelFetch(provider, apiKey, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    if (strict && provider !== "ollama" && provider !== "lmstudio") {
      throw error;
    }
    return { models: sortModels(cachedForProvider), emptyMeansRemoved: false };
  }
};

/** Model-list-only view of {@link fetchProviderModels}, for callers that persist inline. */
export const fetchAvailableModels = async (
  apiKey: string,
  provider: ProviderId,
  persistCache = true,
  strict = false,
): Promise<Model[]> =>
  (await fetchProviderModels(apiKey, provider, persistCache, strict)).models;

/**
 * Read the cached `Model[]` (populated by `fetchAvailableModels`). Reused by
 * the #56 cost snapshot to build a price map without a new network path.
 */
export const getCachedModels = (provider?: ProviderId): Model[] => {
  const models = getStoredModels();
  return provider ? models.filter((model) => isCachedForProvider(model, provider)) : models;
};

const readFreshDisplayCache = (provider: ProviderId): Model[] | null => {
  const lastFetchedAt = lastLiveFetchAt.get(provider);
  const cachedForProvider = getCachedModels(provider);
  if (
    lastFetchedAt !== undefined &&
    cachedForProvider.length > 0 &&
    Date.now() - lastFetchedAt < MODEL_DISPLAY_CACHE_TTL_MS
  ) {
    return sortModels(cachedForProvider);
  }
  return null;
};

/**
 * Cache-first model list for DISPLAY callers (every `ModelSelect` mount: tray,
 * Models tab, each correction preset, PromptGen settings). Without this, every
 * dashboard tab open re-hit the provider HTTP API.
 *
 * Serves the profile-persisted cache when all three hold:
 *   - `refetch` is falsy (the ↻ button and the `settings-updated` broadcast
 *     pass `true` and therefore ALWAYS reach the provider),
 *   - the cache for that provider is non-empty,
 *   - a genuine live fetch happened in this process within the TTL.
 *
 * Otherwise it delegates to `fetchAvailableModels`, which persists the cache
 * exactly as before. `fetchAvailableModels` itself is untouched, so the
 * periodic model monitor and the strict provider-setup validation are
 * unaffected by this path.
 */
export const fetchModelsForDisplay = async (
  apiKey: string,
  provider: ProviderId,
  refetch = false,
): Promise<Model[]> => {
  if (!refetch) {
    const cached = readFreshDisplayCache(provider);
    if (cached) return cached;
  }
  return fetchAvailableModels(apiKey, provider);
};

/**
 * Fetch every enabled provider's models at once, in **exactly one** profile
 * write.
 *
 * `cacheModelsForProvider` is a read-modify-write of the whole profile, so
 * parallel per-provider persists would silently clobber each other: every
 * fetch runs `persistCache: false` and the merge below is the only write.
 * `Promise.allSettled` keeps a rejected provider's previously cached slice,
 * and key-requiring providers fetch `strict: true` so a revoked key surfaces
 * in `errors` instead of being masked by the stale cache.
 *
 * Ordering is per provider group, never global: Ollama stamps `created` in
 * milliseconds and the cloud providers in seconds.
 */
export const fetchModelsForProviders = async (
  providers: readonly ProviderId[],
  keys: Partial<Record<ProviderId, string>>,
  refetch: boolean,
): Promise<{ models: Model[]; errors: Partial<Record<ProviderId, string>> }> => {
  const previousModels = getStoredModels();
  const requested = PROVIDER_ORDER.filter((provider) => providers.includes(provider));

  const settled = await Promise.allSettled(
    requested.map(async (provider): Promise<ProviderFetch> => {
      if (!refetch) {
        const cached = readFreshDisplayCache(provider);
        if (cached) return { models: cached, emptyMeansRemoved: false };
      }
      return fetchProviderModels(
        keys[provider] ?? "",
        provider,
        false,
        PROVIDER_REQUIRES_API_KEY[provider],
      );
    }),
  );

  const errors: Partial<Record<ProviderId, string>> = {};
  const fetchedByProvider = new Map<ProviderId, Model[]>();
  requested.forEach((provider, index) => {
    const outcome = settled[index];
    if (outcome.status === "rejected") {
      const reason: unknown = outcome.reason;
      errors[provider] =
        reason instanceof Error ? reason.message : String(reason);
      return;
    }
    // Empty replaces a slice only when the provider was REACHED and answered
    // nothing; otherwise a blip would wipe the cache.
    const { models: fetched, emptyMeansRemoved } = outcome.value;
    if (fetched.length === 0 && !emptyMeansRemoved) return;
    fetchedByProvider.set(
      provider,
      fetched.map((model) => ({
        ...model,
        // Untagged entries format as `openrouter::…` refs — always tag.
        provider: model.provider ?? provider,
      })),
    );
  });

  const models: Model[] = [];
  const emitted = new Set<Model>();
  for (const provider of PROVIDER_ORDER) {
    const slice =
      fetchedByProvider.get(provider) ?? modelsForProvider(previousModels, provider);
    for (const model of slice) {
      // A legacy untagged entry matches two provider groups; emit it once.
      if (emitted.has(model)) continue;
      emitted.add(model);
      models.push(model);
    }
  }

  if (fetchedByProvider.size > 0) {
    updateProfileSetting("models", models);
  }

  return { models, errors };
};

/**
 * Decide whether a served model id ran locally (Ollama).
 *
 * `provider` is authoritative and short-circuits the cache scan: with three
 * providers in one cache a raw id is ambiguous, and a cloud id can collide
 * with a pulled local model of the same name. Unknown ids return false, so
 * they are priced or fall to N/A.
 */
export const isLocalModelId = (
  servedId: string | undefined,
  provider?: ProviderId,
): boolean => {
  if (!servedId) {
    return false;
  }
  if (provider !== undefined) {
    return provider === "ollama" || provider === "lmstudio";
  }
  const models = getCachedModels();
  return models.some(
    (m) =>
      m.id === servedId &&
      (m.local !== undefined || m.provider === "ollama" || m.provider === "lmstudio"),
  );
};

/**
 * Makes an AI request using OpenAI API with centralized settings management
 * @param options Configuration options for the AI request
 * @returns Promise with the AI response and token information
 */
export const makeAIRequest = async (options: AIRequestOptions) => {
  // System prompt: use options.systemPrompt directly (no global overrides)
  const finalSystemPrompt = options.messages ? "" : options.systemPrompt;

  // Determine which model to use. An empty options.model (e.g. a preset that
  // inherits the global default) resolves to the dynamic global default.
  const modelId = options.model || getDefaultModelId();
  if (!modelId) {
    const error = new Error("You have to select a model first.");
    notifyRequestError(options, error);
    throw error;
  }

  console.log(`Using model for request: ${modelId}`);

  // Hardcoded defaults — per-preset values come through options (undefined = use default)
  const top_p = options.top_p ?? 1.0;

  // Create messages array if not provided
  const messages =
    options.messages ||
    ([
      { role: "system", content: finalSystemPrompt },
      { role: "user", content: options.userPrompt },
    ] as CoreMessage[]);

  // Routing comes from the model ref, not a profile-wide provider: one profile
  // can have all three providers connected at once.
  const resolution = resolveModelRef(modelId, getStoredModels());

  if (!resolution) {
    const parsed = parseModelRef(modelId);
    const error = new Error(
      parsed.provider
        ? mainT("models.error.unresolvable", {
            model: parsed.modelId,
            provider: mainT(PROVIDER_NAME_KEYS[parsed.provider]),
          })
        : mainT("models.error.unresolvableUnknownProvider", {
            model: parsed.modelId,
          }),
    );
    notifyRequestError(options, error);
    throw error;
  }

  // The raw id goes downstream, never the ref — that keeps SQLite history
  // migration-free.
  const rawModelId = resolution.model.id;
  const request = {
    ...options,
    model: rawModelId,
    messages,
    top_p,
  };

  if (resolution.provider === "ollama") {
    console.log("Routing to local Ollama inference");
  }
  if (resolution.provider === "lmstudio") {
    console.log("Routing to local LM Studio inference");
  }

  const makeRequest = providerCapabilities(resolution.provider).makeRequest;
  if (!makeRequest) {
    throw new Error(`Unsupported provider: ${resolution.provider}`);
  }
  const response = await makeRequest(request);
  const session: HistorySessionData = {
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    model: rawModelId,
    provider: resolution.provider,
    responses: response.content,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
  };
  if (options.reasoning !== undefined) {
    session.reasoningEffort = options.reasoning;
  }
  if (top_p !== undefined) {
    session.topP = top_p;
  }
  if (response.resolvedModel !== undefined) {
    session.resolvedModel = response.resolvedModel;
  }
  if (response.reasoningTexts !== undefined) {
    session.reasoningTexts = response.reasoningTexts;
  }
  if (response.cachedTokens !== undefined) {
    session.cachedTokens = response.cachedTokens;
  }
  if (response.cacheWriteTokens !== undefined) {
    session.cacheWriteTokens = response.cacheWriteTokens;
  }
  return { ...response, session };
};

/**
 * Re-exports so `correction.ts`, `promptgen.ts`, the IPC layer, and the existing
 * tests keep importing these from `ai.request/shared` after the move into
 * `~/main/llm/providers/<id>/`.
 */
export { makeLocalAIRequest } from "~/main/llm/providers/ollama/request";
export { makeLmStudioAIRequest } from "~/main/llm/providers/lmstudio/request";
export { fetchOpenAIModels } from "~/main/llm/providers/openai/models";
export { makeOpenAIAIRequest } from "~/main/llm/providers/openai/request";
export {
  fetchOpenRouterModels,
  normalizeOpenRouterModels,
} from "~/main/llm/providers/openrouter/models";
export {
  toConversation,
  usageCounts,
  sumTokenField,
  type AIRequestOptions,
  type AIRequestResponse,
  type CoreMessage,
} from "./requestTypes";

/**
 * Backward-compatible export for internal callers that previously used remote.
 * Both names point at the same OpenRouter implementation, as before the move.
 */
export {
  makeOpenRouterAIRequest,
  makeOpenRouterAIRequest as makeRemoteAIRequest,
} from "~/main/llm/providers/openrouter/request";
