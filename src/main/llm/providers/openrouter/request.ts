/**
 * @file request.ts
 * @description OpenRouter Chat Completions through the AI SDK. Moved verbatim
 * from `ai.request/shared.ts`.
 *
 * This is the only provider path that applies prompt-cache controls. The served
 * model (`response.modelId`) and cache counts (`usage.inputTokenDetails`) come
 * from the SDK with no `include`; the raw response body is requested only for
 * the `n > 1` choices fan-out.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { reasoningForAiSdk } from "~/features/correction/shared/reasoningEffort";
import { getApiKey } from "~/features/providers/store/apiKeyStore";
import { apiStore, getProfileSetting } from "~/features/providers/store/apiStore";
import {
  buildCachedMessages,
  resolveCacheProvider,
} from "~/main/ai.request/cache-strategy";
import {
  usageCounts,
  type AIRequestOptions,
} from "~/main/ai.request/requestTypes";
import { keepAliveFetch } from "~/main/llm/httpKeepAlive";
import { notifyRequestError } from "~/main/notifications/error";

export const makeOpenRouterAIRequest = async (options: AIRequestOptions) => {
  const apiKey =
    (await getApiKey()) ||
    // Legacy fallback for stores not yet migrated to safeStorage.
    (getProfileSetting("apiKey") as string) ||
    (apiStore.get("apiKey") as string) ||
    "";
  if (!apiKey) {
    const error = new Error("OpenRouter API key is missing.");
    notifyRequestError(options, error);
    throw error;
  }

  try {
    console.log(
      `Sending request to OpenRouter with model: ${options.model}, top_p: ${options.top_p}, reasoning: ${options.reasoning ?? "provider-default"}`,
    );

    const openRouter = createOpenRouter({ apiKey: apiKey.trim(), fetch: keepAliveFetch });
    const modelId = options.model as string;
    const modelOpenRouter = openRouter(modelId, {
      extraBody: {
        top_p: options.top_p,
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

    const wantsMultipleChoices = (options.n ?? 1) > 1;
    const reasoning = reasoningForAiSdk(options.reasoning);
    const genResponse = await generateText({
      model: modelOpenRouter,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: conversationMessages as never,
      // `ai` v7 leaves `response.body` undefined unless asked; only the `n > 1`
      // choices below need it. Model and cache counts come from the SDK result.
      ...(wantsMultipleChoices ? { include: { responseBody: true } } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
    });
    const { usage, text, reasoningText } = genResponse;
    const normalizedUsage = usageCounts(usage);
    console.log(
      `makeOpenRouterAIRequest: model=${options.model as string} promptTokens=${normalizedUsage.promptTokens ?? null} completionTokens=${normalizedUsage.completionTokens ?? null}`,
    );

    const resBody = genResponse.response.body;
    const promptTokens = normalizedUsage.promptTokens;
    const completionTokens = normalizedUsage.completionTokens;

    // The SDK maps OpenRouter's `prompt_tokens_details.cached_tokens` / `cache_write_tokens`
    // into normalized `inputTokenDetails`; the raw body is not needed for this.
    const cachedTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    if (cachedTokens > 0 || cacheWriteTokens > 0) {
      console.log(
        `[cache] provider=${cacheProvider} read=${cachedTokens} write=${cacheWriteTokens}`,
      );
    }

    // Process the response content
    let processedContent: string[] = [text];

    // If multiple responses were requested
    if (
      wantsMultipleChoices &&
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

    // The SDK reports the model OpenRouter actually served. For floating aliases
    // (e.g. "~openai/gpt-mini-latest") this is the concrete pinned id.
    const resolvedModel = genResponse.response?.modelId?.trim() || modelId;

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
      ...(typeof reasoningText === "string" && reasoningText.length > 0
        ? { reasoningTexts: [reasoningText] }
        : {}),
    };
  } catch (error) {
    console.error("makeOpenRouterAIRequest error:", error);
    notifyRequestError(options, error, "Failed to get a response from the AI provider.");
    throw error;
  }
};
