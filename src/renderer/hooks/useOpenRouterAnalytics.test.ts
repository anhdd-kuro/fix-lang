/**
 * @file useOpenRouterAnalytics.test.ts
 * @description Pure test for the cache-freshness helper (#59). The hook itself
 * needs a DOM/React renderer (no testing-library installed, per #54 HITL #4),
 * so only the extracted pure logic is unit-tested; the hook wiring is verified
 * in bun run dev.
 */
import { describe, expect, it } from "vitest";
import { cacheIsFresh, OPENROUTER_CACHE_TTL_MS } from "./useOpenRouterAnalytics";

describe("cacheIsFresh", () => {
  it("is fresh within the TTL", () => {
    expect(cacheIsFresh(1000, 1000 + 59_000, OPENROUTER_CACHE_TTL_MS)).toBe(
      true
    );
  });
  it("is stale at/after the TTL boundary", () => {
    expect(cacheIsFresh(1000, 1000 + 60_000, OPENROUTER_CACHE_TTL_MS)).toBe(
      false
    );
    expect(cacheIsFresh(1000, 1000 + 120_000, OPENROUTER_CACHE_TTL_MS)).toBe(
      false
    );
  });
  it("default TTL is 60s", () => {
    expect(OPENROUTER_CACHE_TTL_MS).toBe(60_000);
  });
});
