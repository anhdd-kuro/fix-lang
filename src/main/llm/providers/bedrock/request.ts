/**
 * @file bedrock/request.ts
 * @description AWS Bedrock inference through the AI SDK.
 */
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText } from "ai";
import { reasoningForAiSdk } from "~/features/correction/shared/reasoningEffort";
import { resolveBedrockRegion } from "~/features/providers/shared/bedrockEndpoint";
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

export const makeBedrockAIRequest = async (options: AIRequestOptions) => {
  const profileId = getCurrentProfileId();
  if (!profileId) {
    const error = new Error("No active profile.");
    showErrorNotification(error);
    throw error;
  }

  const accessKeyId = await getProfileSecret(profileId, "bedrock", "api");
  const secretAccessKey = await getProfileSecret(profileId, "bedrock", "secret");
  if (!accessKeyId || !secretAccessKey) {
    const error = new Error("AWS Bedrock credentials are missing.");
    showErrorNotification(error);
    throw error;
  }

  const rawMessages = options.messages;
  if (!rawMessages || rawMessages.length === 0) {
    throw new Error("makeBedrockAIRequest requires non-empty messages.");
  }

  try {
    const modelId = options.model as string;
    const region = resolveBedrockRegion(getProviderEndpoint("bedrock"));
    const bedrock = createAmazonBedrock({
      region,
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
    });
    const conversation = toConversation(rawMessages);
    const request = () =>
      generateText({
        model: bedrock(modelId),
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
      provider: "bedrock" as const,
      resolvedModel: extractResolvedModel(firstBody, modelId),
      ...(reasoningTexts.length > 0 ? { reasoningTexts } : {}),
    };
  } catch (error) {
    console.error("makeBedrockAIRequest error:", error);
    showErrorNotification(error, "Failed to get a response from AWS Bedrock.");
    throw error;
  }
};
