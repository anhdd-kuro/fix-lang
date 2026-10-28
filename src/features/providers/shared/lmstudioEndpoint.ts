/**
 * @file lmstudioEndpoint.ts
 * @description LM Studio local OpenAI-compatible endpoint defaults and sanitization.
 *
 * Electron-free — shared by main, preload, and renderer.
 */
import { z } from "zod";
import { strippingObjectLike } from "~/features/providers/shared/strippingObjectLike";

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
 * and whitespace are rejected so they cannot smuggle into the base URL. Parses
 * to the trimmed host.
 */
export const LocalHostSchema = z
  .string()
  .trim()
  .refine(
    (host) =>
      host.length > 0 &&
      host.length <= 253 &&
      !/[\s/?#@:]/.test(host) &&
      !/^https?$/i.test(host),
  );

/**
 * A TCP port in 1..65535, given as a number or as a non-blank numeric string
 * (`Number()` semantics, so `"0x10"` is 16). NaN, ±Infinity and fractions fail.
 */
export const LocalPortSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .refine((port) => port !== "")
      .transform(Number),
  ])
  .pipe(z.number().int().min(1).max(65535));

/** A local daemon endpoint: both fields must parse, extra fields are dropped. */
export const ProviderEndpointSchema = strippingObjectLike({
  host: LocalHostSchema,
  port: LocalPortSchema,
});

const parsedOrNull = <Parsed>(
  result: { success: true; data: Parsed } | { success: false },
): Parsed | null => (result.success ? result.data : null);

export const sanitizeLmStudioHost = (
  raw: string | null | undefined,
): string | null => parsedOrNull(LocalHostSchema.safeParse(raw));

export const sanitizeLmStudioPort = (
  raw: number | string | null | undefined,
): number | null => parsedOrNull(LocalPortSchema.safeParse(raw));

/**
 * Re-validates an endpoint at runtime even though it is typed: callers hand
 * over values read from disk or from IPC, whose static type is a claim.
 */
export const sanitizeProviderEndpoint = (
  raw: ProviderEndpoint | null | undefined,
): ProviderEndpoint | null =>
  parsedOrNull(ProviderEndpointSchema.safeParse(raw));

export const resolveLmStudioEndpoint = (
  raw: ProviderEndpoint | null | undefined,
): ProviderEndpoint =>
  sanitizeProviderEndpoint(raw) ?? { ...LMSTUDIO_DEFAULT_ENDPOINT };

export const buildLmStudioBaseUrl = (endpoint: ProviderEndpoint): string =>
  `http://${endpoint.host}:${endpoint.port}/v1`;
