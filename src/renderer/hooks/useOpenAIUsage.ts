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
        cacheIsFresh(cached.stampedAt, now(), OPENAI_USAGE_CACHE_TTL_MS)
      ) {
        setData(cached.data);
        setHasKey(cached.data.hasKey);
        // A superseded fetch can no longer clear this, so the request that wins
        // owns the flag on every exit path — otherwise the spinner never stops.
        setLoading(false);
        return;
      }

      if (!force && cached) {
        setData(cached.data);
        setHasKey(cached.data.hasKey);
      }

      // Gate on the admin key (empty state) before the heavier usage call.
      const keyPresent =
        (await window.electronAPI.hasProvisioningKey?.("openai")) ?? false;
      if (!isLatestRequest()) return;
      setHasKey(keyPresent);
      if (!keyPresent) {
        setData(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const result = await window.electronAPI.getOpenAIUsage(range);
        // Cached before the guard on purpose: a superseded payload is still
        // correct for ITS range, so returning to it serves from cache.
        cacheRef.current.set(range, { stampedAt: now(), data: result });
        if (!isLatestRequest()) return;
        setData(result);
        setHasKey(result.hasKey);
      } catch (error) {
        // Degrade quietly; the panel renders per-card unavailable states.
        console.error("OpenAI usage fetch failed", error);
      } finally {
        if (isLatestRequest()) setLoading(false);
      }
    },
    [range, now],
  );

  // Fetch on mount + whenever the range changes (cache may serve it instantly).
  useEffect(() => {
    void load(false);
    // Discard whatever is in flight when the range changes or the panel closes.
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const refresh = useCallback((): void => {
    void load(true);
  }, [load]);

  return { data, loading, hasKey, refresh };
};
