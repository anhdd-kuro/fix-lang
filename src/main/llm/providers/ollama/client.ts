/**
 * @file client.ts
 * @description Ollama daemon client factory. Host comes from the profile's
 * stored endpoint (defaults to 127.0.0.1:11434), matching LM Studio's pattern.
 */
import { Ollama } from "ollama";
import {
  buildOllamaBaseUrl,
  resolveOllamaEndpoint,
} from "~/shared/ollamaEndpoint";
import type { ProviderEndpoint } from "~/shared/lmstudioEndpoint";

export type OllamaClientOptions = {
  endpoint?: ProviderEndpoint | null;
};

export const createOllamaClient = (
  endpoint?: ProviderEndpoint | null,
): Ollama => {
  const resolved = resolveOllamaEndpoint(endpoint);
  return new Ollama({ host: buildOllamaBaseUrl(resolved) });
};

/** Default-endpoint singleton for call sites that have not yet threaded options. */
export const ollamaClient = createOllamaClient();
