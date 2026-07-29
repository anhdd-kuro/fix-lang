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
import type { OpenRouterAnalytics } from "~/main/llm/providers/openrouter/client";
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
  // Only the newest request may commit. Switching range leaves the previous
  // fetch in flight, and a slower one landing last would render the OLD range's
  // dollars under the NEW range's heading — a silently wrong billing figure.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      const requestId = (requestIdRef.current += 1);
      const isLatestRequest = (): boolean => requestIdRef.current === requestId;

      const cached = cacheRef.current.get(range);
      if (
        !force &&
        cached &&
        cacheIsFresh(cached.stampedAt, now(), OPENROUTER_CACHE_TTL_MS)
      ) {
        setData(cached.data);
        setHasKey(cached.data.hasKey);
        // A superseded fetch can no longer clear this, so the request that wins
        // owns the flag on every exit path — otherwise the spinner never stops.
        setLoading(false);
        return;
      }

      // Gate on the key (empty state) before the heavier analytics call.
      const keyPresent =
        (await window.electronAPI.hasProvisioningKey?.("openrouter")) ?? false;
      if (!isLatestRequest()) return;
      setHasKey(keyPresent);
      if (!keyPresent) {
        setData(null);
        setLoading(false);
        return;
      }

      // Serve stale data only after the key check succeeds (stale-while-revalidate).
      if (!force && cached) {
        setData(cached.data);
      }

      setLoading(true);
      try {
        const result = await window.electronAPI.getOpenRouterAnalytics(range);
        // Cached before the guard on purpose: a superseded payload is still
        // correct for ITS range, so returning to it serves from cache.
        cacheRef.current.set(range, { stampedAt: now(), data: result });
        if (!isLatestRequest()) return;
        setData(result);
        setHasKey(result.hasKey);
      } catch (error) {
        // Degrade quietly; the panel renders per-card unavailable states.
        console.error("OpenRouter analytics fetch failed", error);
      } finally {
        if (isLatestRequest()) setLoading(false);
      }
    },
    [range, now]
  );

  // Fetch on mount + whenever the range changes (cache may serve it instantly).
  useEffect(() => {
    void load(false);
    // Discard whatever is in flight when the range changes or the tab closes.
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const refresh = useCallback((): void => {
    void load(true);
  }, [load]);

  return { data, loading, hasKey, refresh };
};
