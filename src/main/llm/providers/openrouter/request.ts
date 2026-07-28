/**
 * @file request.ts
 * @description OpenRouter Chat Completions through the AI SDK. Moved verbatim
 * from `ai.request/shared.ts`.
 *
 * This is the only provider path that applies prompt-cache controls and reads the
 * raw response body (for `n > 1` choices, cache usage, and the concretely served
 * model behind a floating alias).
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import {
  buildCachedMessages,
  extractCacheUsage,
  resolveCacheProvider,
} from "~/main/ai.request/cache-strategy";
import { extractResolvedModel } from "~/main/ai.request/resolve-model";
import { showErrorNotification } from "~/main/notifications/error";
import { getApiKey } from "~/stores/apiKeyStore";
import { apiStore, getProfileSetting } from "~/stores/apiStore";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";

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
