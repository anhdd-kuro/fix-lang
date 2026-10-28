/**
 * @file bedrockEndpoint.ts
 * @description AWS Bedrock region defaults and sanitization.
 *
 * Region is persisted in `providerEndpoints.bedrock.host` (port is unused).
 * Electron-free — shared by main, preload, and renderer.
 */
import { z } from "zod";
import { strippingObjectLike } from "~/features/providers/shared/strippingObjectLike";
import type { ProviderEndpoint } from "~/features/providers/shared/lmstudioEndpoint";

export const BEDROCK_DEFAULT_REGION = "us-east-1";

const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d$/;

/** An AWS region code; parses to its trimmed, lower-cased form. */
export const BedrockRegionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (region) =>
      region.length > 0 && region.length <= 32 && REGION_PATTERN.test(region),
  );

/**
 * A stored Bedrock endpoint: the region either bare or in `host` (the shape
 * `providerEndpoints.bedrock` persists). An object's `host` is the only place
 * looked at once it has one; an object without one is not a region.
 */
export const StoredBedrockRegionSchema = z.union([
  BedrockRegionSchema,
  strippingObjectLike({ host: BedrockRegionSchema }).transform(
    ({ host }) => host,
  ),
]);

export const sanitizeBedrockRegion = (raw: string): string | null => {
  const parsed = BedrockRegionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const resolveBedrockRegion = (
  raw: Pick<ProviderEndpoint, "host"> | string | null | undefined,
): string => {
  const parsed = StoredBedrockRegionSchema.safeParse(raw);
  return parsed.success ? parsed.data : BEDROCK_DEFAULT_REGION;
};
