/**
 * @file request.ts
 * @description LM Studio OpenAI-compatible Chat Completions through the AI SDK.
 * Moved verbatim from `ai.request/shared.ts`.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import {
  buildLmStudioBaseUrl,
  resolveLmStudioEndpoint,
} from "~/features/providers/shared/lmstudioEndpoint";
import {
  getCurrentProfileId,
  getProviderEndpoint,
} from "~/features/providers/store/apiStore";
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
import { notifyRequestError } from "~/main/notifications/error";
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
      provider: "lmstudio",
      resolvedModel: extractResolvedModel(firstBody, modelId),
    };
    if (reasoningTexts.length > 0) result.reasoningTexts = reasoningTexts;
    return result;
  } catch (error) {
    console.error("makeLmStudioAIRequest error:", error);
    notifyRequestError(
      options,
      error,
      "Failed to get a response from LM Studio.",
    );
    throw error;
  }
};
