/**
 * @file useOpenAIUsage.ts
 * @description Renderer hook for the OpenAI panel of the Usage tab. Fetches the
 * combined usage payload on panel-open (mount), on range change, and on explicit
 * Refresh — with a ~60s per-range client cache TTL. There is NO background
 * polling (no setInterval): rapid sub-tab switches within the TTL reuse the cache.
 *
 * The admin key is never touched here; the hook only invokes the key-free
 * combined IPC and reads `hasProvisioningKey("openai")` for the empty state.
 * Mirrors `useOpenRouterAnalytics`, deliberately: the two providers return
 * different cards, so sharing one hook would mean a union in every consumer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cacheIsFresh } from "./useOpenRouterAnalytics";
import type { OpenAIUsage } from "~/main/llm/providers/openai/usage.client";
import type { UsageRange } from "~/shared/usage";

export const OPENAI_USAGE_CACHE_TTL_MS = 60_000;

type CacheEntry = { stampedAt: number; data: OpenAIUsage };

export type UseOpenAIUsage = {
  data: OpenAIUsage | null;
  loading: boolean;
  hasKey: boolean | null;
  refresh: () => void;
};

/**
 * @param range active 7d/30d window
 * @param now injectable clock for deterministic testing (defaults to Date.now)
 */
export const useOpenAIUsage = (
  range: UsageRange,
  now: () => number = Date.now,
): UseOpenAIUsage => {
  const [data, setData] = useState<OpenAIUsage | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  // Per-range cache; survives re-renders but not unmount.
  const cacheRef = useRef<Map<UsageRange, CacheEntry>>(new Map());

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      const cached = cacheRef.current.get(range);
      if (
        !force &&
        cached &&
        cacheIsFresh(cached.stampedAt, now(), OPENAI_USAGE_CACHE_TTL_MS)
      ) {
        setData(cached.data);
        setHasKey(cached.data.hasKey);
        return;
      }

      // Gate on the admin key (empty state) before the heavier usage call.
      const keyPresent =
        (await window.electronAPI.hasProvisioningKey?.("openai")) ?? false;
      setHasKey(keyPresent);
      if (!keyPresent) {
        setData(null);
        return;
      }

      setLoading(true);
      try {
        const result = await window.electronAPI.getOpenAIUsage(range);
        cacheRef.current.set(range, { stampedAt: now(), data: result });
        setData(result);
        setHasKey(result.hasKey);
      } catch (error) {
        // Degrade quietly; the panel renders per-card unavailable states.
        console.error("OpenAI usage fetch failed", error);
      } finally {
        setLoading(false);
      }
    },
    [range, now],
  );

  // Fetch on mount + whenever the range changes (cache may serve it instantly).
  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback((): void => {
    void load(true);
  }, [load]);

  return { data, loading, hasKey, refresh };
};
