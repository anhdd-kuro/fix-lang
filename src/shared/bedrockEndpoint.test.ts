/**
 * @file bedrockEndpoint.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  BEDROCK_DEFAULT_REGION,
  resolveBedrockRegion,
  sanitizeBedrockRegion,
} from "./bedrockEndpoint";

describe("bedrockEndpoint", () => {
  it("accepts standard AWS region codes", () => {
    expect(sanitizeBedrockRegion("us-east-1")).toBe("us-east-1");
    expect(sanitizeBedrockRegion(" EU-West-1 ")).toBe("eu-west-1");
  });

  it("rejects invalid region strings", () => {
    expect(sanitizeBedrockRegion("")).toBeNull();
    expect(sanitizeBedrockRegion("invalid")).toBeNull();
  });

  it("falls back to the default region", () => {
    expect(resolveBedrockRegion(undefined)).toBe(BEDROCK_DEFAULT_REGION);
    expect(resolveBedrockRegion({ host: "ap-northeast-1" })).toBe(
      "ap-northeast-1",
    );
  });
});
