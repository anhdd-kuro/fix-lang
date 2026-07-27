/**
 * @file client.ts
 * @description LM Studio OpenAI-compatible local server probe + helpers.
 */
import OpenAI from "openai";
import {
  LMSTUDIO_DEFAULT_API_KEY,
  buildLmStudioBaseUrl,
  resolveLmStudioEndpoint,
  type ProviderEndpoint,
} from "~/shared/lmstudioEndpoint";
import type { Model } from "~/shared/providers";

export type LmStudioProbe = {
  reachable: boolean;
  models: Model[];
  error?: string;
};

export type LmStudioClientOptions = {
  endpoint?: ProviderEndpoint | null;
  apiKey?: string | null;
};

export const resolveLmStudioApiKey = (apiKey?: string | null): string => {
  const trimmed = apiKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : LMSTUDIO_DEFAULT_API_KEY;
};

export const createLmStudioOpenAIClient = (options: LmStudioClientOptions = {}): OpenAI => {
  const endpoint = resolveLmStudioEndpoint(options.endpoint);
  return new OpenAI({
    baseURL: buildLmStudioBaseUrl(endpoint),
    apiKey: resolveLmStudioApiKey(options.apiKey),
    timeout: 5000,
    maxRetries: 0,
  });
};

const toLmStudioModel = (model: { id: string; created?: number | null }): Model => ({
  id: model.id,
  name: model.id,
  created: model.created ?? 0,
  provider: "lmstudio",
});

/**
 * Probe the LM Studio OpenAI-compatible `/v1/models` endpoint. Distinguishes
 * "server down" from "server up with no models loaded".
 */
export async function probeLmStudio(
  options: LmStudioClientOptions = {},
): Promise<LmStudioProbe> {
  try {
    const client = createLmStudioOpenAIClient(options);
    const page = await client.models.list();
    return {
      reachable: true,
      models: page.data.map(toLmStudioModel),
    };
  } catch (error) {
    return {
      reachable: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
