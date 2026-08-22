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

/**
 * Whether this host keeps traffic on the machine.
 *
 * `sanitizeLmStudioHost` accepts ANY hostname, so "Ollama" and "LM Studio" name
 * a protocol, not a destination — a user may point either at `192.168.1.50` or
 * a public host. Anything that decides "this text never leaves the machine"
 * must ask this, not the provider id.
 *
 * Answers only for forms it is certain about: `localhost`, 127.0.0.0/8, and
 * IPv6 `::1`. Every other host — including a name that happens to resolve to
 * loopback — reads as NOT loopback, because resolution is not available here
 * and the wrong answer in that direction is the one that leaks.
 */
export const isLoopbackHost = (raw: unknown): boolean => {
  if (typeof raw !== "string") return false;
  const host = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return octets[0] === 127;
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
