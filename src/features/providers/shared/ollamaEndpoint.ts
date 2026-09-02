/**
 * @file ollamaEndpoint.ts
 * @description Ollama local daemon endpoint defaults and URL builder.
 *
 * Electron-free — shared by main, preload, and renderer. Reuses the same
 * host/port sanitizers as LM Studio (`sanitizeProviderEndpoint`).
 */
import {
  sanitizeProviderEndpoint,
  type ProviderEndpoint,
} from "~/features/providers/shared/lmstudioEndpoint";

export const OLLAMA_DEFAULT_HOST = "127.0.0.1";
export const OLLAMA_DEFAULT_PORT = 11434;

export const OLLAMA_DEFAULT_ENDPOINT: ProviderEndpoint = Object.freeze({
  host: OLLAMA_DEFAULT_HOST,
  port: OLLAMA_DEFAULT_PORT,
});

export const resolveOllamaEndpoint = (raw: unknown): ProviderEndpoint =>
  sanitizeProviderEndpoint(raw) ?? { ...OLLAMA_DEFAULT_ENDPOINT };

/** Ollama JS client `host` is a full origin, no `/v1` suffix. */
export const buildOllamaBaseUrl = (endpoint: ProviderEndpoint): string =>
  `http://${endpoint.host}:${endpoint.port}`;
