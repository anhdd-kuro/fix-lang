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
import { getLocalModels } from "~/main/llm/models/discover";
import { showErrorNotification } from "~/main/notifications/error";
import { getApiKey } from "~/stores/apiKeyStore";
import {
  apiStore,
  getCurrentProfileId,
  getDefaultModelId,
  getProfileById,
  getProfileSetting,
} from "~/stores/apiStore";
import { getProfileSecret } from "~/stores/profileSecretStore";
import { ollamaClient } from "../llm";
import {
  buildCachedMessages,
  extractCacheUsage,
  resolveCacheProvider,
} from "./cache-strategy";
import { extractResolvedModel } from "./resolve-model";
import type { Model, ProviderId } from "~/stores/apiStore";

type CoreMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

/** Resolve routing from the current profile, never from a model-id convention. */
export const getActiveProvider = (): ProviderId => {
  const profileId = getCurrentProfileId();
  return profileId ? (getProfileById(profileId)?.provider ?? "openrouter") : "openrouter";
};

const isCachedForProvider = (model: Model, provider: ProviderId): boolean =>
  provider === "ollama"
    ? model.provider === "ollama" || model.local !== undefined
    : model.provider === provider ||
      (provider === "openrouter" && model.provider === undefined && !model.local);

const sortModels = (models: Model[]): Model[] =>
  [...models].sort((a, b) => {
    const byCreated = b.created - a.created;
    if (byCreated !== 0) return byCreated;
    const byIdLength = a.id.length - b.id.length;
    return byIdLength !== 0 ? byIdLength : a.id.localeCompare(b.id);
  });

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

/**
 * Fetch models for exactly one provider. Direct OpenAI models deliberately do
 * not receive OpenRouter price fields, preventing fabricated cost estimates.
 */
export const fetchAvailableModels = async (
  apiKey: string,
  provider: ProviderId = getActiveProvider(),
): Promise<Model[]> => {
  const cachedModels = (apiStore.get("models") as Model[]) || [];
  const cachedForProvider = cachedModels.filter((model) =>
    isCachedForProvider(model, provider),
  );

  try {
    let models: Model[];
    if (provider === "ollama") {
      models = (await getLocalModels()).map((model) => ({ ...model, provider: "ollama" }));
    } else if (!apiKey) {
      console.log(`No ${provider} API key provided; using cached models`);
      models = cachedForProvider;
    } else if (provider === "openai") {
      models = await fetchOpenAIModels(apiKey);
    } else {
      models = await fetchOpenRouterModels(apiKey);
    }

    const sortedModels = sortModels(models);
    if (sortedModels.length > 0) {
      apiStore.set("models", sortedModels);
    }
    return sortedModels;
  } catch (error) {
    console.error(`Error fetching ${provider} models:`, error);
    return sortModels(cachedForProvider);
  }
};

/**
 * Read the cached `Model[]` (populated by `fetchAvailableModels`). Reused by
 * the #56 cost snapshot to build a price map without a new network path.
 */
export const getCachedModels = (provider?: ProviderId): Model[] => {
  const models = (apiStore.get("models") as Model[]) || [];
  return provider ? models.filter((model) => isCachedForProvider(model, provider)) : models;
};

/**
 * Decide whether a served model id ran locally (Ollama). Derived from the
 * cached model list WITHOUT touching the request pipeline (#56 HITL #2): a
 * served id is local if a cached `Model` with that id carries the `local` flag.
 * Returns false when the id is unknown (it will then be priced or fall to N/A).
 */
export const isLocalModelId = (servedId: string | undefined): boolean => {
  if (!servedId) {
    return false;
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

  // Get all models from store
  const models = (apiStore.get("models") as Model[]) || [];
  const selectedModel = models.find((m) => m.id === modelId);

  if (!selectedModel) {
    const error = new Error(`Model ${modelId} not found in model registry.`);
    showErrorNotification(error);
    throw error;
  }

  const provider = getActiveProvider();
  if (provider === "ollama") {
    if (!selectedModel.local && selectedModel.provider !== "ollama") {
      const error = new Error(`Model ${modelId} is not an Ollama model.`);
      showErrorNotification(error);
      throw error;
    }
    console.log("Routing to local Ollama inference");
    return makeLocalAIRequest({
      ...options,
      model: modelId,
      messages,
      temperature,
      top_p,
      maxTokens,
    });
  }

  if (selectedModel.provider && selectedModel.provider !== provider) {
    const error = new Error(`Model ${modelId} is not available from ${provider}.`);
    showErrorNotification(error);
    throw error;
  }

  if (provider === "openai") {
    return makeOpenAIAIRequest({
      ...options,
      model: modelId,
      messages,
      temperature,
      top_p,
      maxTokens,
    });
  }

  return makeOpenRouterAIRequest({
    ...options,
    model: modelId,
    messages,
    temperature,
    top_p,
    maxTokens,
  });
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
