/**
 * @file request.ts
 * @description Local Ollama inference. Moved verbatim from
 * `ai.request/shared.ts` (where it was named `makeLocalAIRequest`; the export
 * name is preserved because callers and tests use it).
 */
import { resolveOllamaEndpoint } from "~/features/providers/shared/ollamaEndpoint";
import { getProviderEndpoint } from "~/features/providers/store/apiStore";
import { getLocalModels } from "~/main/llm/models/discover";
import { notifyRequestError } from "~/main/notifications/error";
import { createOllamaClient } from "./client";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";

/**
 * One token count off the daemon's chat response, or `null` for "it did not say".
 *
 * NEVER `0` as the missing value. `0` is a MEASUREMENT everywhere downstream:
 * `recordUsage` (`~/features/autocomplete/store/autocompleteUsageStore`) and
 * `resolveResponseCostUsd` (`~/features/autocomplete/main/service`) both decide
 * "the provider did not tell us" with `=== null`, so a zero booked every Ollama
 * response as fully measured — `tokenlessResponses` stayed 0 and the day
 * reported a measured zero-token total where the truth was unknown. Same rule
 * `sumTokenField` states for every other provider.
 *
 * A REPORTED zero is left as zero: Ollama serves a fully cached prompt with
 * `prompt_eval_count: 0`, and that one really is a measurement.
 *
 * The daemon is an external boundary, so the field is validated rather than
 * trusted. The `ollama` package types both counts as a required `number`, but an
 * older daemon or a proxy in front of it can omit them.
 */
const tokenCount = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : null;

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
    // Make the request to the local LLM.
    //
    // Ollama's client takes neither an `abortSignal` nor `maxOutputTokens`: the
    // token cap is `options.num_predict`, and cancellation is a client-level
    // `abort()` rather than a per-request signal. Aborting is safe only because
    // this client is constructed per request, so it owns exactly one call.
    const client = createOllamaClient(
      resolveOllamaEndpoint(getProviderEndpoint("ollama")),
    );
    const abortClient = () => client.abort();
    options.abortSignal?.addEventListener("abort", abortClient, { once: true });
    // A signal that fired BEFORE this point never reaches the listener above:
    // `addEventListener` does not replay an event that has already dispatched.
    // The window is real and routinely hit — a superseded autocomplete keystroke
    // or a profile switch aborts while the lazy provider import is still
    // resolving — and without this the call still started, so the cancellation
    // saved nothing and a machine already busy ran one more stale inference.
    //
    // `throwIfAborted()` throws the signal's own reason, which for the bare
    // `controller.abort()` every caller here uses is the same
    // `AbortError`-named DOMException an abort DURING the call produces. The
    // caller therefore cannot tell the two apart, and `isAbortError`
    // (`~/main/notifications/error`) keeps both silent.
    options.abortSignal?.throwIfAborted();
    const response = await client
      .chat({
        messages: serializedMessages,
        model: modelId,
        options: {
          top_p: options.top_p || 0.9,
          ...(options.maxOutputTokens !== undefined
            ? { num_predict: options.maxOutputTokens }
            : {}),
          ...(options.stop ? { stop: options.stop } : {}),
        },
      })
      .finally(() => {
        options.abortSignal?.removeEventListener("abort", abortClient);
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
      // Ollama DOES report usage — the previous `0` sat under a comment
      // claiming otherwise. See `tokenCount` for why the fallback is `null`.
      promptTokens: tokenCount(response.prompt_eval_count),
      completionTokens: tokenCount(response.eval_count),
      model: modelId,
      provider: "ollama" as const,
      // Local models have no alias indirection — served id == requested id.
      resolvedModel: modelId,
    };
  } catch (error) {
    console.error("Local LLM request failed:", error);
    notifyRequestError(options, error, "The local AI request failed. Please try again.");
    throw error;
  }
};
