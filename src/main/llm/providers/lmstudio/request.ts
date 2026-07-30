/**
 * @file request.ts
 * @description LM Studio OpenAI-compatible Chat Completions through the AI SDK.
 * Moved verbatim from `ai.request/shared.ts`.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { reasoningForAiSdk } from "~/features/correction/shared/reasoningEffort";
import {
  buildLmStudioBaseUrl,
  resolveLmStudioEndpoint,
} from "~/features/providers/shared/lmstudioEndpoint";
import { getCurrentProfileId, getProviderEndpoint } from "~/features/providers/store/apiStore";
import { getProfileSecret } from "~/features/providers/store/profileSecretStore";
import {
  sumTokenField,
  toConversation,
  usageCounts,
  type AIRequestOptions,
} from "~/main/ai.request/requestTypes";
import { extractResolvedModel } from "~/main/ai.request/resolve-model";
import { showErrorNotification } from "~/main/notifications/error";
import { resolveLmStudioApiKey } from "./client";

export const makeLmStudioAIRequest = async (options: AIRequestOptions) => {
  const profileId = getCurrentProfileId();
  const storedKey = profileId
    ? await getProfileSecret(profileId, "lmstudio", "api")
    : null;
  const endpoint = resolveLmStudioEndpoint(getProviderEndpoint("lmstudio"));
  const apiKey = resolveLmStudioApiKey(storedKey);
  const baseURL = buildLmStudioBaseUrl(endpoint);

  const rawMessages = options.messages;
  if (!rawMessages || rawMessages.length === 0) {
    throw new Error("makeLmStudioAIRequest requires non-empty messages.");
  }

  try {
    const modelId = options.model as string;
    const openai = createOpenAI({ apiKey, baseURL });
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

    const reasoningTexts = responses
      .map((response) => response.reasoningText)
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    return {
      content: responses.map((response) => response.text),
      prompts: responses.map((response) => response.text),
      promptTokens: sumTokenField(counts, "promptTokens"),
      completionTokens: sumTokenField(counts, "completionTokens"),
      model: modelId,
      provider: "lmstudio" as const,
      resolvedModel: extractResolvedModel(firstBody, modelId),
      ...(reasoningTexts.length > 0 ? { reasoningTexts } : {}),
    };
  } catch (error) {
    console.error("makeLmStudioAIRequest error:", error);
    showErrorNotification(error, "Failed to get a response from LM Studio.");
    throw error;
  }
};
