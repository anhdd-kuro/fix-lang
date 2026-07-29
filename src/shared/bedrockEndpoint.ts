/**
 * @file bedrockEndpoint.ts
 * @description AWS Bedrock region defaults and sanitization.
 *
 * Region is persisted in `providerEndpoints.bedrock.host` (port is unused).
 * Electron-free — shared by main, preload, and renderer.
 */

export const BEDROCK_DEFAULT_REGION = "us-east-1";

const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d$/;

export const sanitizeBedrockRegion = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const region = raw.trim().toLowerCase();
  if (region.length === 0 || region.length > 32) return null;
  if (!REGION_PATTERN.test(region)) return null;
  return region;
};

export const resolveBedrockRegion = (raw: unknown): string =>
  sanitizeBedrockRegion(
    typeof raw === "object" && raw !== null && "host" in raw
      ? (raw as { host: unknown }).host
      : raw,
  ) ?? BEDROCK_DEFAULT_REGION;
