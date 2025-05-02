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
import { InferenceService } from "~/main/llm/inference/service";
import { getLocalModels } from "~/main/llm/models/discover";
import { makeTonePrompt } from "~/prompts/index";
import { store } from "~/stores/apiStore";
import { StringPrettifier } from "~/utils";
import type { CoreMessage } from "ai";
import type { GlobalSettings, Model } from "~/stores/apiStore";

/**
 * Retrieves global prompt settings from the store
 * @returns GlobalSettings object with all current settings
 */
export const getGlobalPromptSettings = (): GlobalSettings => {
  return store.get("globalSettings") as GlobalSettings;
};


export const fetchAvailableModels = async (
  apiKey: string
): Promise<Model[]> => {
  // Get previously cached models (if any)
  const cachedModels = (store.get("models") as Model[]) || [];
  let cloudModels: Model[] = [];
  let localModels: Model[] = [];

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
          `API returned ${response.status}: ${response.statusText}`
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
      `Using ${cloudModels.length} cached cloud models due to missing API key`
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
    store.set("models", sortedModels);
    console.log(`Cached ${sortedModels.length} models for future use`);
  }

  return sortedModels;
};

/**
 * Applies global settings to a system prompt
 * @param systemPrompt - Base system prompt to augment with global settings
 * @returns Final system prompt with applied global settings
 */
export const applyGlobalSettings = (systemPrompt: string): string => {
  const settings = getGlobalPromptSettings();
  const promptParts: string[] = [];

  // If custom system prompt exists, use it instead of the provided one
  if (settings.customSystemPrompt) {
    promptParts.push(settings.customSystemPrompt);
  } else {
    promptParts.push(systemPrompt);
  }

  // Add tone adjustment if specified
  if (settings.tone) {
    promptParts.push(makeTonePrompt(settings.tone));
  }

  // Combine all prompt parts and clean up the formatting
  return new StringPrettifier(promptParts.join("\n"))
    .removeExtraSpaces()
    .removeEmptyLines().value;
};

/**
 * Makes an AI request using OpenAI API with centralized settings management
 * @param options Configuration options for the AI request
 * @returns Promise with the AI response and token information
 */
export const makeAIRequest = async (options: AIRequestOptions) => {
  // Apply global settings to the system prompt (if not using custom messages)
  const finalSystemPrompt = options.messages
    ? ""
    : applyGlobalSettings(options.systemPrompt);

  // Determine which model to use
  const modelId = options.model || store.get("selectedModel");
  if (!modelId) {
    throw new Error("You have to select a model first.");
  }

  console.log(`Using model for request: ${modelId}`);

  // Get global settings for AI parameters
  const globalSettings = store.get("globalSettings");
  const temperature = options.temperature || globalSettings?.temperature || 1;
  const top_p = options.top_p || globalSettings?.top_p || 1.0;
  const maxTokens = options.maxTokens || globalSettings?.maxTokens || 10000;

  // Create messages array if not provided
  const messages =
    options.messages ||
    ([
      { role: "system", content: finalSystemPrompt },
      { role: "user", content: options.userPrompt },
    ] as CoreMessage[]);

  // Get all models from store
  const models = store.get("models") || [];
  const selectedModel = models.find((m) => m.id === modelId);

  if (!selectedModel) {
    throw new Error(`Model ${modelId} not found in model registry.`);
  }

  // Check if the model is local or remote
  // Check if this is a local model by explicitly using the Model interface
  const modelObj = selectedModel;

  if (modelObj && modelObj.local) {
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
  `.trim()
  );

  try {
    // Initialize the inference service
    const inferenceService = new InferenceService();

    const messages = options.messages || [];

    // Make the request to the local LLM
    const response = await inferenceService.chat({
      messages: messages.map((msg) => ({
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
      })),
      modelId,
      options: {
        temperature: options.temperature,
        top_p: options.top_p,
        num_predict: options.maxTokens,
      },
    });

    // Extract the response content
    const text = response.message.content;

    // Return in a format compatible with the OpenAI response format
    return {
      content: [text],
      prompts: [text], // For compatibility with existing code
      promptTokens: null, // Local models don't provide token information
      completionTokens: null,
      model: modelId,
    };
  } catch (error) {
    console.error("Local LLM request failed:", error);

    // Fall back to OpenAI/OpenRouter if configured and API key exists
    const apiKey = store.get("apiKey");
    if (apiKey) {
      console.log(
        "Falling back to remote model due to local inference failure"
      );
      return makeRemoteAIRequest({
        ...options,
        model: store.get("selectedModel"), // Use default model for fallback
      });
    }

    throw error;
  }
};

/**
 * Makes an AI request using OpenAI API with centralized settings management
 * @param options Configuration options for the AI request
 * @returns Promise with the AI response and token information
 */
export const makeRemoteAIRequest = async (options: AIRequestOptions) => {
  // Get API key from store
  const apiKey = store.get("apiKey");
  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  try {
    console.log(
      `Sending request to OpenRouter with model: ${options.model}, temperature: ${options.temperature}, top_p: ${options.top_p}, max_completion_tokens: ${options.maxTokens}
      System Prompt: ${options.systemPrompt || ""}
      User Prompt: ${options.userPrompt || ""}
    `.trim()
    );

    const openRouter = createOpenRouter({ apiKey });
    const modelOpenRouter = openRouter(options.model as string, {
      extraBody: {
        temperature: options.temperature,
        top_p: options.top_p,
        max_completion_tokens: options.maxTokens,
        n: options.n || 1,
        stop: options.stop,
      },
    });
    const genResponse = await generateText({
      model: modelOpenRouter,
      messages: options.messages || [],
    });
    console.log(
      `🚀 \n - makeRemoteAIRequest \n - genResponse:`,
      JSON.stringify(genResponse, null, 2)
    );
    const { usage, text } = genResponse;

    const resBody = genResponse.response.body;
    // Extract token information first
    const promptTokens = usage?.promptTokens ?? null;
    const completionTokens = usage?.completionTokens ?? null;

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
          choice.message?.content ? choice.message.content.trim() : []
        )
        .filter(Boolean);

      if (contents.length > 0) {
        processedContent = contents;
      }
    }

    // Return the processed content and token information
    return {
      content: processedContent,
      prompts: processedContent, // For compatibility with existing code
      promptTokens,
      completionTokens,
      model: options.model as string,
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
export const fetchOpenAIModels = async (
  apiKey: string
): Promise<
  { id: string; object: string; created: number; owned_by: string }[]
> => {
  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }
  try {
    const openai = new OpenAI({ apiKey });
    // https://platform.openai.com/docs/api-reference/models/list
    const response = await openai.models.list();
    // Return only essential fields for dropdown
    return response.data.map(({ id, object, created, owned_by }) => ({
      id,
      object,
      created,
      owned_by,
    }));
  } catch (error) {
    console.error("Error fetching OpenAI models:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to fetch OpenAI models."
    );
  }
};

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
  prompts?: string[];
}
