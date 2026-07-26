/**
 * @file shared.ts
 * @description Shared utilities for making AI requests across different features
 *
 * NOTE: This file centralizes AI request functionality that was previously scattered
 * across individual feature implementations. It also incorporates utility functions
 * previously in prompts/utils.ts to provide a single source of truth for OpenAI interactions.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { OpenAI } from "openai";
import { mainT } from "~/main/i18n";
import { getLocalModels, probeOllama } from "~/main/llm/models/discover";
import { showErrorNotification } from "~/main/notifications/error";
import { parseModelRef, resolveModelRef } from "~/shared/modelRef";
import {
  modelsForProvider,
  PROVIDER_ORDER,
  PROVIDER_REQUIRES_API_KEY,
} from "~/shared/providers";
import { getApiKey } from "~/stores/apiKeyStore";
import {
  apiStore,
  getCurrentProfileId,
  getDefaultModelId,
  getProfileSetting,
  isModelForProvider,
  updateProfileSetting,
} from "~/stores/apiStore";
import { getProfileSecret } from "~/stores/profileSecretStore";
import { ollamaClient } from "../llm";
import {
  buildCachedMessages,
  extractCacheUsage,
  resolveCacheProvider,
} from "./cache-strategy";
import { extractResolvedModel } from "./resolve-model";
import type { TKey } from "~/shared/i18n/translate";
import type { Model, ProviderId } from "~/stores/apiStore";

type CoreMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

const PROVIDER_NAME_KEYS = {
  openai: "models.select.provider.openai",
  openrouter: "models.select.provider.openrouter",
  ollama: "models.select.provider.ollama",
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

const normalizeOpenRouterModels = (data: unknown): Model[] => {
  if (!Array.isArray(data)) return [];
  return data.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Partial<Model>;
    if (!raw.id || typeof raw.id !== "string") return [];
    return [{
      ...raw,
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name : raw.id,
      created: typeof raw.created === "number" ? raw.created : 0,
      provider: "openrouter",
    } satisfies Model];
  });
};

const fetchOpenRouterModels = async (apiKey: string): Promise<Model[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }
    const payload = (await response.json()) as { data?: unknown };
    return normalizeOpenRouterModels(payload.data);
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchOpenAIModels = async (apiKey: string): Promise<Model[]> => {
  const client = new OpenAI({ apiKey, timeout: 5000, maxRetries: 0 });
  const page = await client.models.list();
  return page.data.map((model) => ({
    id: model.id,
    name: model.id,
    created: model.created ?? 0,
    provider: "openai",
  }));
};

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
    } else if (!apiKey) {
      console.log(`No ${provider} API key provided; using cached models`);
      models = cachedForProvider;
      // Cache read-through, not a provider round-trip — must not look "fresh".
      liveFetch = false;
    } else if (provider === "openai") {
      models = await fetchOpenAIModels(apiKey);
    } else {
      models = await fetchOpenRouterModels(apiKey);
    }

    if (liveFetch) {
      lastLiveFetchAt.set(provider, Date.now());
    }
    const sortedModels = sortModels(models);
    if (persistCache && (sortedModels.length > 0 || emptyMeansRemoved)) {
      cacheModelsForProvider(provider, sortedModels);
    }
    return { models: sortedModels, emptyMeansRemoved };
  } catch (error) {
    console.error(`Error fetching ${provider} models:`, error);
    if (strict && provider !== "ollama") {
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
    return provider === "ollama";
  }
  const models = getCachedModels();
  return models.some((m) => m.id === servedId && m.local !== undefined);
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
    showErrorNotification(error);
    throw error;
  }

  console.log(`Using model for request: ${modelId}`);

  // Hardcoded defaults — per-preset values come through options (undefined = use default)
  const temperature = options.temperature ?? 1;
  const top_p = options.top_p ?? 1.0;
  const maxTokens = options.maxTokens ?? 10000;

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
    showErrorNotification(error);
    throw error;
  }

  // The raw id goes downstream, never the ref — that keeps SQLite history
  // migration-free.
  const rawModelId = resolution.model.id;
  const request = {
    ...options,
    model: rawModelId,
    messages,
    temperature,
    top_p,
    maxTokens,
  };

  if (resolution.provider === "ollama") {
    console.log("Routing to local Ollama inference");
    return makeLocalAIRequest(request);
  }

  if (resolution.provider === "openai") {
    return makeOpenAIAIRequest(request);
  }

  return makeOpenRouterAIRequest(request);
};

/**
 * Makes an AI request using local LLM with Ollama
 * @param options Configuration options for the AI request
 * @returns Promise with the AI response and token information
 */
export const makeLocalAIRequest = async (options: AIRequestOptions) => {
  const modelId = options.model as string;

  console.log(
    `Sending request to local LLM with model: ${modelId}, temperature: ${options.temperature}`,
  );

  try {
    // Log the request details
    console.log(
      `[DEBUG CRITICAL] Local inference request for model ID: ${modelId}`,
    );

    // Create messages array, ensuring we have actual content
    let messages = options.messages || [];

    // Get available local models to find the correct model ID
    const localModels = await getLocalModels();

    // For development, allow fallback to a known working model if the requested one isn't found
    if (!localModels.some((model) => model.id === modelId)) {
      throw new Error(`Model ${modelId} not found in local models.`);
    }

    console.log(`[DEBUG CRITICAL] Final model ID for Ollama: ${modelId}`);

    // Ensure we have at least one message
    if (messages.length === 0 && options.userPrompt) {
      // If we have no messages but have user prompt, create a simple messages array
      messages = [
        {
          role: "system",
          content: options.systemPrompt || "You are a helpful assistant.",
        },
        { role: "user", content: options.userPrompt },
      ];
    }

    console.log(
      `[DEBUG CRITICAL] Sending ${messages.length} messages to Ollama model`,
    );

    const serializedMessages = messages.map((msg) => ({
      role:
        msg.role === "assistant"
          ? "assistant"
          : msg.role === "system"
            ? "system"
            : "user",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));
    // Make the request to the local LLM
    const response = await ollamaClient.chat({
      messages: serializedMessages,
      model: modelId,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9,
        num_predict: options.maxTokens,
      },
    });

    console.log(
      "[DEBUG CRITICAL] Ollama response total duration:",
      response.total_duration,
    );
    // Extract the response content
    const text = response.message.content;

    // Return in a format compatible with the OpenAI response format
    return {
      content: [text],
      prompts: [text], // For compatibility with existing code
      promptTokens: 0, // Local models don't provide token information
      completionTokens: 0,
      model: modelId,
      provider: "ollama" as const,
      // Local models have no alias indirection — served id == requested id.
      resolvedModel: modelId,
    };
  } catch (error) {
    console.error("Local LLM request failed:", error);
    showErrorNotification(error, "The local AI request failed. Please try again.");
    throw error;
  }
};

/**
 * Makes an AI request using OpenAI API with centralized settings management
 * @param options Configuration options for the AI request
 * @returns Promise with the AI response and token information
 */
export const makeOpenRouterAIRequest = async (options: AIRequestOptions) => {
  const apiKey =
    (await getApiKey()) ||
    // Legacy fallback for stores not yet migrated to safeStorage.
    (getProfileSetting("apiKey") as string) ||
    (apiStore.get("apiKey") as string) ||
    "";
  if (!apiKey) {
    const error = new Error("OpenRouter API key is missing.");
    showErrorNotification(error);
    throw error;
  }

  try {
    console.log(
      `Sending request to OpenRouter with model: ${options.model}, temperature: ${options.temperature}, top_p: ${options.top_p}, max_completion_tokens: ${options.maxTokens}`,
    );

    const openRouter = createOpenRouter({ apiKey: apiKey.trim() });
    const modelId = options.model as string;
    const modelOpenRouter = openRouter(modelId, {
      extraBody: {
        temperature: options.temperature,
        top_p: options.top_p,
        max_completion_tokens: options.maxTokens,
        n: options.n || 1,
        stop: options.stop,
      },
    });

    // Apply provider-aware prompt caching to the system message when supported
    const rawMessages = options.messages;
    if (!rawMessages || rawMessages.length === 0) {
      throw new Error("makeOpenRouterAIRequest requires non-empty messages.");
    }
    const cacheProvider = resolveCacheProvider(modelId);
    // AI SDK v7 rejects `system`-role entries inside `messages`
    // (standardize-prompt: `allowSystemInMessages` defaults to false). The
    // system prompt must be passed via the dedicated `system` option instead.
    const systemPrompt = rawMessages
      .filter((m) => m.role === "system")
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      )
      .join("\n\n");
    const conversationMessages = buildCachedMessages(
      rawMessages.filter((m) => m.role !== "system") as {
        role: string;
        content: unknown;
      }[],
      cacheProvider,
    );

    const genResponse = await generateText({
      model: modelOpenRouter,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: conversationMessages as never,
    });
    const { usage, text } = genResponse;
    const normalizedUsage = usage as {
      promptTokens?: number;
      completionTokens?: number;
    };
    console.log(
      `makeOpenRouterAIRequest: model=${options.model as string} promptTokens=${normalizedUsage.promptTokens ?? null} completionTokens=${normalizedUsage.completionTokens ?? null}`,
    );

    const resBody = genResponse.response.body;
    const promptTokens = normalizedUsage?.promptTokens ?? null;
    const completionTokens = normalizedUsage?.completionTokens ?? null;

    // Extract cache-usage metadata from raw OpenRouter response body
    const rawUsage =
      resBody && typeof resBody === "object" && "usage" in resBody
        ? (resBody as Record<string, unknown>)["usage"]
        : undefined;
    const { cachedTokens, cacheWriteTokens } = extractCacheUsage(rawUsage);
    if (cachedTokens > 0 || cacheWriteTokens > 0) {
      console.log(
        `[cache] provider=${cacheProvider} read=${cachedTokens} write=${cacheWriteTokens}`,
      );
    }

    // Process the response content
    let processedContent: string[] = [text];

    // If multiple responses were requested
    if (
      options.n &&
      options.n > 1 &&
      resBody &&
      typeof resBody === "object" &&
      "choices" in resBody &&
      Array.isArray(resBody.choices)
    ) {
      // Extract all responses
      const contents = resBody.choices
        .flatMap((choice) =>
          choice.message?.content ? choice.message.content.trim() : [],
        )
        .filter(Boolean);

      if (contents.length > 0) {
        processedContent = contents;
      }
    }

    // The provider reports the model it actually served in the response body.
    // For floating aliases (e.g. "~openai/gpt-mini-latest") this is the concrete
    // pinned id; falls back to the requested id when absent.
    const resolvedModel = extractResolvedModel(resBody, options.model as string);

    // Return the processed content and token information
    return {
      content: processedContent,
      prompts: processedContent, // For compatibility with existing code
      promptTokens,
      completionTokens,
      model: options.model as string,
      provider: "openrouter" as const,
      resolvedModel,
      cachedTokens,
      cacheWriteTokens,
    };
  } catch (error) {
    console.error("makeOpenRouterAIRequest error:", error);
    showErrorNotification(error, "Failed to get a response from the AI provider.");
    throw error;
  }
};

/** Backward-compatible export for internal callers that previously used remote. */
export const makeRemoteAIRequest = makeOpenRouterAIRequest;

const toConversation = (messages: CoreMessage[]) => {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) =>
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    )
    .join("\n\n");
  return {
    system,
    messages: messages.filter((message) => message.role !== "system") as never,
  };
};

const usageCounts = (usage: unknown): { promptTokens: number | null; completionTokens: number | null } => {
  if (!usage || typeof usage !== "object") {
    return { promptTokens: null, completionTokens: null };
  }
  const value = usage as Record<string, unknown>;
  const count = (primary: string, fallback: string): number | null => {
    const raw = value[primary] ?? value[fallback];
    return typeof raw === "number" ? raw : null;
  };
  return {
    promptTokens: count("promptTokens", "inputTokens"),
    completionTokens: count("completionTokens", "outputTokens"),
  };
};

/**
 * Direct OpenAI Chat Completions through the AI SDK. It intentionally bypasses
 * OpenRouter cache controls and raw response parsing. Multiple choices are
 * separate AI SDK calls because the SDK's standard interface emits one text.
 */
export const makeOpenAIAIRequest = async (options: AIRequestOptions) => {
  const profileId = getCurrentProfileId();
  const apiKey = profileId
    ? await getProfileSecret(profileId, "openai", "api")
    : null;
  if (!apiKey) {
    const error = new Error("OpenAI API key is missing.");
    showErrorNotification(error);
    throw error;
  }

  const rawMessages = options.messages;
  if (!rawMessages || rawMessages.length === 0) {
    throw new Error("makeOpenAIAIRequest requires non-empty messages.");
  }

  try {
    const modelId = options.model as string;
    const openai = createOpenAI({ apiKey: apiKey.trim() });
    const conversation = toConversation(rawMessages);
    const request = () =>
      generateText({
        model: openai.chat(modelId),
        ...(conversation.system ? { system: conversation.system } : {}),
        messages: conversation.messages,
        temperature: options.temperature,
        topP: options.top_p,
        maxOutputTokens: options.maxTokens,
        ...(options.stop ? { stopSequences: options.stop } : {}),
      });
    const responses = await Promise.all(
      Array.from({ length: Math.max(1, options.n ?? 1) }, request),
    );
    const counts = responses.map((response) => usageCounts(response.usage));
    const sum = (key: "promptTokens" | "completionTokens") => {
      const values = counts.map((count) => count[key]).filter((count): count is number => count !== null);
      return values.length > 0 ? values.reduce((total, count) => total + count, 0) : null;
    };
    const firstBody = responses[0]?.response.body;

    return {
      content: responses.map((response) => response.text),
      prompts: responses.map((response) => response.text),
      promptTokens: sum("promptTokens"),
      completionTokens: sum("completionTokens"),
      model: modelId,
      provider: "openai" as const,
      resolvedModel: extractResolvedModel(firstBody, modelId),
    };
  } catch (error) {
    console.error("makeOpenAIAIRequest error:", error);
    showErrorNotification(error, "Failed to get a response from OpenAI.");
    throw error;
  }
};

/**
 * Fetches available OpenAI models using the provided API key.
 * @param apiKey The OpenAI API key to use for this request.
 * @returns A promise that resolves with an array of model objects (id, object, created, owned_by, etc)
 */

/**
 * Options for common AI request operations
 */
export type AIRequestOptions = {
  /** System prompt to guide the AI's behavior */
  systemPrompt: string;
  /** User message to send to the AI */
  userPrompt: string;
  /** OpenAI model to use (if not specified, pulls from store) */
  model?: string;
  /** Temperature for sampling (if not specified, pulls from store) */
  temperature?: number;
  /** Top_p for nucleus sampling (if not specified, pulls from store) */
  top_p?: number;
  /** Maximum tokens to generate (if not specified, pulls from store) */
  maxTokens?: number;
  /** Number of responses to generate */
  n?: number;
  /** Custom messages if needed (overrides system/user prompt params) */
  messages?: CoreMessage[];
  /** Stop sequences */
  stop?: string[] | null;
};

/**
 * Response structure for AI request operations
 */
export type AIRequestResponse = {
  content: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  model: string;
  /** Explicit provider used for this request; never inferred from the model id. */
  provider: ProviderId;
  /** Concrete model the provider actually served (resolves alias indirection) */
  resolvedModel?: string;
  prompts?: string[];
  /** Tokens served from prompt cache (Anthropic/Gemini) */
  cachedTokens?: number;
  /** Tokens written to prompt cache (Anthropic/Gemini) */
  cacheWriteTokens?: number;
};
