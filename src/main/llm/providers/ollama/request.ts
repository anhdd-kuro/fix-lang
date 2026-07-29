/**
 * @file request.ts
 * @description Local Ollama inference. Moved verbatim from
 * `ai.request/shared.ts` (where it was named `makeLocalAIRequest`; the export
 * name is preserved because callers and tests use it).
 */
import { getLocalModels } from "~/main/llm/models/discover";
import { showErrorNotification } from "~/main/notifications/error";
import { resolveOllamaEndpoint } from "~/shared/ollamaEndpoint";
import { getProviderEndpoint } from "~/stores/apiStore";
import { createOllamaClient } from "./client";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";

export const makeLocalAIRequest = async (options: AIRequestOptions) => {
  const modelId = options.model as string;

  console.log(`Sending request to local LLM with model: ${modelId}`);

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
    const response = await createOllamaClient(
      resolveOllamaEndpoint(getProviderEndpoint("ollama")),
    ).chat({
      messages: serializedMessages,
      model: modelId,
      options: {
        top_p: options.top_p || 0.9,
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
