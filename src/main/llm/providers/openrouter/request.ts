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
import { z } from "zod";
import { getApiKey } from "~/features/providers/store/apiKeyStore";
import {
  apiStore,
  getProfileSetting,
} from "~/features/providers/store/apiStore";
import {
  buildCachedMessages,
  extractCacheUsage,
  resolveCacheProvider,
} from "~/main/ai.request/cache-strategy";
import {
  usageCounts,
  type AIRequestOptions,
  type AIRequestResponse,
} from "~/main/ai.request/requestTypes";
import { extractResolvedModel } from "~/main/ai.request/resolve-model";
import {
  aiSdkCallSettings,
  aiSdkSystemOption,
} from "~/main/llm/providers/aiSdkCallSettings";
import { messageContentText } from "~/main/llm/providers/messageContentText";
import { keepAliveFetch } from "~/main/llm/httpKeepAlive";
import { notifyRequestError } from "~/main/notifications/error";

/**
 * Raw response body readers. A body without the key reads as `undefined`, the
 * same as the key holding `undefined`.
 */
const BodyUsageSchema = z.object({ usage: z.unknown() });
/**
 * `z.any()` on purpose: each choice is read as `choice.message?.content` and
 * trimmed, exactly as before this schema existed, so a malformed choice still
 * fails the request the way it always has instead of being skipped.
 */
const BodyChoicesSchema = z.object({ choices: z.array(z.any()) });

export const makeOpenRouterAIRequest = async (options: AIRequestOptions) => {
  const apiKey =
    (await getApiKey()) ||
    // Legacy fallback for stores not yet migrated to safeStorage.
    getProfileSetting("apiKey") ||
    // SAFETY: the legacy top-level `apiKey` was only ever written as the
    // OpenRouter key string, before keys moved to safeStorage.
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

    const openRouter = createOpenRouter({
      apiKey: apiKey.trim(),
      fetch: keepAliveFetch,
    });
    // SAFETY: production calls arrive only through the provider registry from
    // `makeAIRequest`, which always sets `model` to the resolved raw model id.
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
      .map((m) => messageContentText(m.content))
      .join("\n\n");
    const conversationMessages = buildCachedMessages(
      rawMessages.filter((m) => m.role !== "system"),
      cacheProvider,
    );

    // OpenRouter carries `stop` in the model's `extraBody` above, so it is not
    // forwarded again as AI SDK `stopSequences`.
    const genResponse = await generateText({
      model: modelOpenRouter,
      ...aiSdkSystemOption(systemPrompt),
      // SAFETY: these are the caller's non-system messages, unchanged —
      // `buildCachedMessages` only rewrites `system` entries, filtered out above.
      messages: conversationMessages as never,
      ...aiSdkCallSettings({
        reasoning: options.reasoning,
        abortSignal: options.abortSignal,
        maxOutputTokens: options.maxOutputTokens,
      }),
    });
    const { usage, text, reasoningText } = genResponse;
    const normalizedUsage = usageCounts(usage);
    console.log(
      `makeOpenRouterAIRequest: model=${modelId} promptTokens=${normalizedUsage.promptTokens ?? null} completionTokens=${normalizedUsage.completionTokens ?? null}`,
    );

    const resBody = genResponse.response.body;
    const promptTokens = normalizedUsage.promptTokens;
    const completionTokens = normalizedUsage.completionTokens;

    // Extract cache-usage metadata from raw OpenRouter response body
    const bodyUsage = BodyUsageSchema.safeParse(resBody);
    const rawUsage = bodyUsage.success ? bodyUsage.data.usage : undefined;
    const { cachedTokens, cacheWriteTokens } = extractCacheUsage(rawUsage);
    if (cachedTokens > 0 || cacheWriteTokens > 0) {
      console.log(
        `[cache] provider=${cacheProvider} read=${cachedTokens} write=${cacheWriteTokens}`,
      );
    }

    // Process the response content
    let processedContent: string[] = [text];

    // If multiple responses were requested
    const bodyChoices =
      options.n && options.n > 1 ? BodyChoicesSchema.safeParse(resBody) : null;
    if (bodyChoices?.success) {
      // Extract all responses
      const contents = bodyChoices.data.choices
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
    const resolvedModel = extractResolvedModel(resBody, modelId);

    // Return the processed content and token information
    const result: AIRequestResponse = {
      content: processedContent,
      prompts: processedContent, // For compatibility with existing code
      promptTokens,
      completionTokens,
      model: modelId,
      provider: "openrouter",
      resolvedModel,
      cachedTokens,
      cacheWriteTokens,
    };
    if (reasoningText != null && reasoningText.length > 0) {
      result.reasoningTexts = [reasoningText];
    }
    return result;
  } catch (error) {
    console.error("makeOpenRouterAIRequest error:", error);
    notifyRequestError(
      options,
      error,
      "Failed to get a response from the AI provider.",
    );
    throw error;
  }
};
