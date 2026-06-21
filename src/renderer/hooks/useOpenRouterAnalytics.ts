/**
 * @file useOpenRouterAnalytics.ts
 * @description Renderer hook for the OpenRouter tab (#59). Fetches the combined
 * analytics on tab-open (mount), on range change, and on explicit Refresh —
 * with a ~60s per-range client cache TTL. There is NO background polling (no
 * setInterval): rapid tab switches within the TTL reuse the cached value.
 *
 * The provisioning key is never touched here; the hook only invokes the
 * key-free combined IPC and reads `hasProvisioningKey()` for the empty state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenRouterAnalytics } from "~/main/llm/openrouter/client";
import type { OpenRouterRange } from "~/preload/features/openrouter";

/** Pure: is a cache entry stamped at `ts` still fresh at `now` within `ttlMs`? */
export const cacheIsFresh = (
  ts: number,
  now: number,
  ttlMs: number
): boolean => now - ts < ttlMs;

export const OPENROUTER_CACHE_TTL_MS = 60_000;

type CacheEntry = { stampedAt: number; data: OpenRouterAnalytics };

export type UseOpenRouterAnalytics = {
  data: OpenRouterAnalytics | null;
  loading: boolean;
  hasKey: boolean | null;
  refresh: () => void;
};

/**
 * @param range active 7d/30d window
 * @param now injectable clock for deterministic testing (defaults to Date.now)
 */
export const useOpenRouterAnalytics = (
  range: OpenRouterRange,
  now: () => number = Date.now
): UseOpenRouterAnalytics => {
  const [data, setData] = useState<OpenRouterAnalytics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  // Per-range cache; survives re-renders but not unmount.
  const cacheRef = useRef<Map<OpenRouterRange, CacheEntry>>(new Map());

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      const cached = cacheRef.current.get(range);
      if (
        !force &&
        cached &&
        cacheIsFresh(cached.stampedAt, now(), OPENROUTER_CACHE_TTL_MS)
      ) {
        setData(cached.data);
        setHasKey(cached.data.hasKey);
        return;
      }

      // Gate on the key (empty state) before the heavier analytics call.
      const keyPresent =
        (await window.electronAPI.hasProvisioningKey?.()) ?? false;
      setHasKey(keyPresent);
      if (!keyPresent) {
        setData(null);
        return;
      }

      setLoading(true);
      try {
        const result = await window.electronAPI.getOpenRouterAnalytics(range);
        cacheRef.current.set(range, { stampedAt: now(), data: result });
        setData(result);
        setHasKey(result.hasKey);
      } catch (error) {
        // Degrade quietly; the panel renders per-card unavailable states.
        console.error("OpenRouter analytics fetch failed", error);
      } finally {
        setLoading(false);
      }
    },
    [range, now]
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
