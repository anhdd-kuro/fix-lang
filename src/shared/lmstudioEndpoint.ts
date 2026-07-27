/**
 * @file lmstudioEndpoint.ts
 * @description LM Studio local OpenAI-compatible endpoint defaults and sanitization.
 *
 * Electron-free — shared by main, preload, and renderer.
 */

export type ProviderEndpoint = {
  host: string;
  port: number;
};

export const LMSTUDIO_DEFAULT_HOST = "127.0.0.1";
export const LMSTUDIO_DEFAULT_PORT = 1234;
export const LMSTUDIO_DEFAULT_API_KEY = "lm-studio";

export const LMSTUDIO_DEFAULT_ENDPOINT: ProviderEndpoint = Object.freeze({
  host: LMSTUDIO_DEFAULT_HOST,
  port: LMSTUDIO_DEFAULT_PORT,
});

/**
 * Accept a hostname or IPv4/IPv6 literal only — schemes, paths, query strings,
 * and whitespace are rejected so they cannot smuggle into the base URL.
 */
export const sanitizeLmStudioHost = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const host = raw.trim();
  if (host.length === 0 || host.length > 253) return null;
  if (/[\s/?#@:]/.test(host)) return null;
  if (/^https?$/i.test(host)) return null;
  return host;
};

export const sanitizeLmStudioPort = (raw: unknown): number | null => {
  const port =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw.trim())
        : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
};

export const sanitizeProviderEndpoint = (
  raw: unknown,
): ProviderEndpoint | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const host = sanitizeLmStudioHost(value.host);
  const port = sanitizeLmStudioPort(value.port);
  if (host === null || port === null) return null;
  return { host, port };
};

export const resolveLmStudioEndpoint = (raw: unknown): ProviderEndpoint =>
  sanitizeProviderEndpoint(raw) ?? { ...LMSTUDIO_DEFAULT_ENDPOINT };

export const buildLmStudioBaseUrl = (endpoint: ProviderEndpoint): string =>
  `http://${endpoint.host}:${endpoint.port}/v1`;
