/**
 * @file shared.ts
 * @description Shared utilities for making AI requests across different features
 *
 * NOTE: This file centralizes AI request functionality that was previously scattered
 * across individual feature implementations. It also incorporates utility functions
 * previously in prompts/utils.ts to provide a single source of truth for OpenAI interactions.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { Notification } from "electron";
import { OpenAI } from "openai";
import { getLocalModels } from "~/main/llm/models/discover";
import {
  apiStore,
  getDefaultModelId,
  getProfileSetting,
} from "~/stores/apiStore";
import { ollamaClient } from "../llm";
import {
  buildCachedMessages,
  extractCacheUsage,
  resolveCacheProvider,
} from "./cache-strategy";
import { extractResolvedModel } from "./resolve-model";
import type { Model } from "~/stores/apiStore";

type CoreMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

export const fetchAvailableModels = async (
  apiKey: string,
): Promise<Model[]> => {
  // Get previously cached models (if any)
  const cachedModels = (apiStore.get("models") as Model[]) || [];
  let cloudModels: Model[];
  let localModels: Model[];

  // First get local models - these should work even without API key
  try {
    localModels = await getLocalModels();
    console.log(`Found ${localModels.length} local models`);
  } catch (error) {
    console.error("Error fetching local models:", error);
    // Use cached local models if fresh fetch fails
    localModels = cachedModels.filter((model) => model.local) || [];
    console.log(`Using ${localModels.length} cached local models`);
  }

  // Only try to fetch cloud models if we have an API key
  if (apiKey) {
    try {
      /**
       * List available models (GET /models)
       * @see: https://openrouter.ai/docs/api-reference/list-available-models
       */
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `API returned ${response.status}: ${response.statusText}`,
        );
      }

      // Get cloud models from OpenRouter
      cloudModels = (await response.json()).data as Model[];
      console.log(`Found ${cloudModels.length} cloud models`);
    } catch (error) {
      console.error("Error fetching cloud models:", error);
      // Use cached cloud models if fresh fetch fails
      cloudModels = cachedModels.filter((model) => !model.local) || [];
      console.log(`Using ${cloudModels.length} cached cloud models`);
    }
  } else {
    console.log("No API key provided, skipping cloud model fetch");
    // Use cached cloud models if API key is missing
    cloudModels = cachedModels.filter((model) => !model.local) || [];
    console.log(
      `Using ${cloudModels.length} cached cloud models due to missing API key`,
    );
  }

  // Combine cloud and local models
  const allModels = [...cloudModels, ...localModels];

  // Sort models (local models first, then by created date)
  const sortedModels = allModels.sort((a, b) => {
    // First sort by source (local first)
    const aIsLocal = a.local !== undefined;
    const bIsLocal = b.local !== undefined;
    if (aIsLocal && !bIsLocal) return -1;
    if (!aIsLocal && bIsLocal) return 1;

    // Then by created date (newest first)
    const resultByCreated = b.created - a.created;
    if (resultByCreated !== 0) return resultByCreated;

    // Then by ID length (shorter first) and alphabetically
    const resultByIdLength = a.id.length - b.id.length;
    if (resultByIdLength !== 0) return resultByIdLength;
    return a.id.localeCompare(b.id);
  });

  // Cache the sorted models for future use
  if (sortedModels.length > 0) {
    apiStore.set("models", sortedModels);
    console.log(`Cached ${sortedModels.length} models for future use`);
  }

  return sortedModels;
};

/**
 * Read the cached `Model[]` (populated by `fetchAvailableModels`). Reused by
 * the #56 cost snapshot to build a price map without a new network path.
 */
export const getCachedModels = (): Model[] =>
  (apiStore.get("models") as Model[]) || [];

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
    throw new Error("You have to select a model first.");
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
    throw new Error(`Model ${modelId} not found in model registry.`);
  }

  if (selectedModel.local) {
    console.log(`[DEBUG CRITICAL] Routing to local Ollama inference`);
    return makeLocalAIRequest({
      ...options,
      model: modelId,
      messages,
      temperature,
      top_p,
      maxTokens,
    });
  }

  // For remote models (OpenAI/OpenRouter)
  return makeRemoteAIRequest({
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
    `Sending request to local LLM with model: ${modelId}, temperature: ${options.temperature}
    System Prompt: ${options.systemPrompt || ""}
    User Prompt: ${options.userPrompt || ""}
  `.trim(),
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
      // Local models have no alias indirection — served id == requested id.
      resolvedModel: modelId,
    };
  } catch (error) {
    console.error("Local LLM request failed:", error);
    throw error;
  }
};

/**
 * Makes an AI request using OpenAI API with centralized settings management
 * @param options Configuration options for the AI request
 * @returns Promise with the AI response and token information
 */
export const makeRemoteAIRequest = async (options: AIRequestOptions) => {
  // Get API key from current profile first, fallback to legacy root key
  const profileApiKey = (getProfileSetting("apiKey") as string) || "";
  const legacyApiKey = (apiStore.get("apiKey") as string) || "";
  const apiKey = profileApiKey || legacyApiKey;
  console.log(
    "OpenRouter API key source",
    JSON.stringify({
      profileKeyLength: profileApiKey.length,
      legacyKeyLength: legacyApiKey.length,
      usingProfileKey: !!profileApiKey,
    }),
  );
  if (!apiKey) {
    throw new Error("OpenRouter API key is missing.");
  }

  try {
    console.log(
      `Sending request to OpenRouter with model: ${options.model}, temperature: ${options.temperature}, top_p: ${options.top_p}, max_completion_tokens: ${options.maxTokens}
      System Prompt: ${options.systemPrompt || ""}
      User Prompt: ${options.userPrompt || ""}
    `.trim(),
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
      throw new Error("makeRemoteAIRequest requires non-empty messages.");
    }
    const cacheProvider = resolveCacheProvider(modelId);
    const cachedMessages = buildCachedMessages(
      rawMessages as { role: string; content: unknown }[],
      cacheProvider,
    );

    const genResponse = await generateText({
      model: modelOpenRouter,
      messages: cachedMessages as never,
    });
    console.log(
      `🚀 \n - makeRemoteAIRequest \n - genResponse:`,
      JSON.stringify(genResponse, null, 2),
    );
    const { usage, text } = genResponse;

    const resBody = genResponse.response.body;
    const normalizedUsage = usage as {
      promptTokens?: number;
      completionTokens?: number;
    };
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
      resolvedModel,
      cachedTokens,
      cacheWriteTokens,
    };
  } catch (error) {
    console.error("makeRemoteAIRequest error:", error);
    new Notification({
      title: "API Error",
      body: `Failed to get response from API: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }).show();
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
  /** Concrete model the provider actually served (resolves alias indirection) */
  resolvedModel?: string;
  prompts?: string[];
  /** Tokens served from prompt cache (Anthropic/Gemini) */
  cachedTokens?: number;
  /** Tokens written to prompt cache (Anthropic/Gemini) */
  cacheWriteTokens?: number;
};
