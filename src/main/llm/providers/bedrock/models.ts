/**
 * @file bedrock/models.ts
 * @description Live AWS Bedrock foundation-model list.
 */
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import type { Model } from "~/shared/providers";

export type BedrockCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export const fetchBedrockModels = async (
  credentials: BedrockCredentials,
): Promise<Model[]> => {
  const client = new BedrockClient({
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
  const response = await client.send(new ListFoundationModelsCommand({}));
  const models = response.modelSummaries ?? [];
  return models
    .filter(
      (entry) =>
        typeof entry.modelId === "string" &&
        entry.modelId.length > 0 &&
        (entry.outputModalities ?? []).includes("TEXT"),
    )
    .map((entry) => ({
      id: entry.modelId as string,
      name: entry.modelName ?? (entry.modelId as string),
      created: entry.modelLifecycle?.creationTime
        ? Math.floor(entry.modelLifecycle.creationTime.getTime() / 1000)
        : 0,
      provider: "bedrock" as const,
    }));
};
