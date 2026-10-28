/**
 * @file request.ts
 * @description Direct OpenAI Chat Completions through the AI SDK. Moved verbatim
 * from `ai.request/shared.ts`.
 *
 * It intentionally bypasses OpenRouter cache controls and raw response parsing.
 * Multiple choices are separate AI SDK calls because the SDK's standard interface
 * emits one text per call.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getCurrentProfileId } from "~/features/providers/store/apiStore";
import { getProfileSecret } from "~/features/providers/store/profileSecretStore";
import {
  sumTokenField,
  toConversation,
  usageCounts,
  type AIRequestOptions,
  type AIRequestResponse,
} from "~/main/ai.request/requestTypes";
import { extractResolvedModel } from "~/main/ai.request/resolve-model";
import {
  aiSdkCallSettings,
  aiSdkSystemOption,
} from "~/main/llm/providers/aiSdkCallSettings";
import { keepAliveFetch } from "~/main/llm/httpKeepAlive";
import { notifyRequestError } from "~/main/notifications/error";

export const makeOpenAIAIRequest = async (options: AIRequestOptions) => {
  const profileId = getCurrentProfileId();
  const apiKey = profileId
    ? await getProfileSecret(profileId, "openai", "api")
    : null;
  if (!apiKey) {
    const error = new Error("OpenAI API key is missing.");
    notifyRequestError(options, error);
    throw error;
  }

  const rawMessages = options.messages;
  if (!rawMessages || rawMessages.length === 0) {
    throw new Error("makeOpenAIAIRequest requires non-empty messages.");
  }

  try {
    // SAFETY: production calls arrive only through the provider registry from
    // `makeAIRequest`, which always sets `model` to the resolved raw model id.
    const modelId = options.model as string;
    const openai = createOpenAI({
      apiKey: apiKey.trim(),
      fetch: keepAliveFetch,
    });
    const conversation = toConversation(rawMessages);
    const request = () =>
      generateText({
        model: openai.chat(modelId),
        ...aiSdkSystemOption(conversation.system),
        messages: conversation.messages,
        topP: options.top_p,
        ...aiSdkCallSettings(options),
      });
    const responses = await Promise.all(
      Array.from({ length: Math.max(1, options.n ?? 1) }, request),
    );
    const counts = responses.map((response) => usageCounts(response.usage));
    const firstBody = responses[0]?.response.body;

    const reasoningTexts = responses
      .map((response) => response.reasoningText)
      .filter(
        (text): text is string => typeof text === "string" && text.length > 0,
      );
    const result: AIRequestResponse = {
      content: responses.map((response) => response.text),
      prompts: responses.map((response) => response.text),
      promptTokens: sumTokenField(counts, "promptTokens"),
      completionTokens: sumTokenField(counts, "completionTokens"),
      model: modelId,
      provider: "openai",
      resolvedModel: extractResolvedModel(firstBody, modelId),
    };
    if (reasoningTexts.length > 0) result.reasoningTexts = reasoningTexts;
    return result;
  } catch (error) {
    console.error("makeOpenAIAIRequest error:", error);
    notifyRequestError(options, error, "Failed to get a response from OpenAI.");
    throw error;
  }
};
