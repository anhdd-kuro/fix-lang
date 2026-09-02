/**
 * @file anthropic/request.ts
 * @description Anthropic Messages API through the AI SDK, mirroring the Bedrock
 * path — same Claude models, a first-party key instead of SigV4.
 *
 * `reasoning` is forwarded rather than translated here on purpose: the provider
 * package maps it per model (adaptive thinking + `effort` on the models that
 * take it, a thinking budget on the ones that still do) and drops `topP` on the
 * models that reject it. Hand-rolling either mapping would 400 the moment
 * Anthropic retires a parameter on a new model.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { reasoningForAiSdk } from "~/features/correction/shared/reasoningEffort";
import { getCurrentProfileId } from "~/features/providers/store/apiStore";
import { getProfileSecret } from "~/features/providers/store/profileSecretStore";
import {
  sumTokenField,
  toConversation,
  usageCounts,
  type AIRequestOptions,
} from "~/main/ai.request/requestTypes";
import { extractResolvedModel } from "~/main/ai.request/resolve-model";
import { keepAliveFetch } from "~/main/llm/httpKeepAlive";
import { notifyRequestError } from "~/main/notifications/error";

export const makeAnthropicAIRequest = async (options: AIRequestOptions) => {
  const profileId = getCurrentProfileId();
  if (!profileId) {
    const error = new Error("No active profile.");
    notifyRequestError(options, error);
    throw error;
  }

  const apiKey = (await getProfileSecret(profileId, "anthropic", "api")) ?? "";
  if (!apiKey.trim()) {
    const error = new Error("Anthropic API key is missing.");
    notifyRequestError(options, error);
    throw error;
  }

  const rawMessages = options.messages;
  if (!rawMessages || rawMessages.length === 0) {
    throw new Error("makeAnthropicAIRequest requires non-empty messages.");
  }

  try {
    const modelId = options.model as string;
    const anthropic = createAnthropic({
      apiKey: apiKey.trim(),
      fetch: keepAliveFetch,
    });
    const conversation = toConversation(rawMessages);
    const request = () =>
      generateText({
        model: anthropic(modelId),
        ...(conversation.system ? { system: conversation.system } : {}),
        messages: conversation.messages,
        topP: options.top_p,
        ...(() => {
          const reasoning = reasoningForAiSdk(options.reasoning);
          return reasoning !== undefined ? { reasoning } : {};
        })(),
        ...(options.stop ? { stopSequences: options.stop } : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        ...(options.maxOutputTokens !== undefined
          ? { maxOutputTokens: options.maxOutputTokens }
          : {}),
      });
    // The Messages API has no `n`, so sibling responses are N separate calls —
    // the same shape the Bedrock path uses for the identical reason.
    const responses = await Promise.all(
      Array.from({ length: Math.max(1, options.n ?? 1) }, request),
    );
    const counts = responses.map((response) => usageCounts(response.usage));
    const firstBody = responses[0]?.response.body;

    const reasoningTexts = responses
      .map((response) => response.reasoningText)
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    return {
      content: responses.map((response) => response.text),
      prompts: responses.map((response) => response.text),
      promptTokens: sumTokenField(counts, "promptTokens"),
      completionTokens: sumTokenField(counts, "completionTokens"),
      model: modelId,
      provider: "anthropic" as const,
      resolvedModel: extractResolvedModel(firstBody, modelId),
      ...(reasoningTexts.length > 0 ? { reasoningTexts } : {}),
    };
  } catch (error) {
    console.error("makeAnthropicAIRequest error:", error);
    notifyRequestError(options, error, "Failed to get a response from Anthropic.");
    throw error;
  }
};
