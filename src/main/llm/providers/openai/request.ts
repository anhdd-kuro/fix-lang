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
import {
  sumTokenField,
  toConversation,
  usageCounts,
  type AIRequestOptions,
} from "~/main/ai.request/requestTypes";
import { extractResolvedModel } from "~/main/ai.request/resolve-model";
import { showErrorNotification } from "~/main/notifications/error";
import { reasoningForAiSdk } from "~/shared/reasoningEffort";
import { getCurrentProfileId } from "~/stores/apiStore";
import { getProfileSecret } from "~/stores/profileSecretStore";

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
        topP: options.top_p,
        ...(() => {
          const reasoning = reasoningForAiSdk(options.reasoning);
          return reasoning !== undefined ? { reasoning } : {};
        })(),
        ...(options.stop ? { stopSequences: options.stop } : {}),
      });
    const responses = await Promise.all(
      Array.from({ length: Math.max(1, options.n ?? 1) }, request),
    );
    const counts = responses.map((response) => usageCounts(response.usage));
    const firstBody = responses[0]?.response.body;

    return {
      content: responses.map((response) => response.text),
      prompts: responses.map((response) => response.text),
      promptTokens: sumTokenField(counts, "promptTokens"),
      completionTokens: sumTokenField(counts, "completionTokens"),
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
