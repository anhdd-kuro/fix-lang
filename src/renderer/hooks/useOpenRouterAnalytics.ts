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
import {
  cacheIsFresh,
  readUsageCache,
  requestUsageData,
  USAGE_CACHE_TTL_MS,
} from "./usageRequestCache";
import { useActiveProfileId } from "./useActiveProfileId";
import type { OpenRouterRange } from "~/features/usage/preload/openrouter";
import type { OpenRouterAnalytics } from "~/main/llm/providers/openrouter/client";

export { cacheIsFresh };

export const OPENROUTER_CACHE_TTL_MS = USAGE_CACHE_TTL_MS;

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
  now: () => number = Date.now,
): UseOpenRouterAnalytics => {
  const [dataState, setDataState] = useState<{
    profileId: string;
    value: OpenRouterAnalytics | null;
  }>({ profileId: "", value: null });
  const [loading, setLoading] = useState<boolean>(false);
  const [keyState, setKeyState] = useState<{
    profileId: string;
    value: boolean | null;
  }>({ profileId: "", value: null });
  const profileId = useActiveProfileId();
  // Only the newest request may commit. Switching range leaves the previous
  // fetch in flight, and a slower one landing last would render the OLD range's
  // dollars under the NEW range's heading — a silently wrong billing figure.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      const requestId = (requestIdRef.current += 1);
      const isLatestRequest = (): boolean => requestIdRef.current === requestId;
      if (!profileId) return;
      const commitData = (value: OpenRouterAnalytics | null): void => {
        setDataState({ profileId, value });
      };
      const commitHasKey = (value: boolean): void => {
        setKeyState({ profileId, value });
      };

      const cacheKey = { profileId, provider: "openrouter", range } as const;
      const cached = readUsageCache<OpenRouterAnalytics>(cacheKey, now());

      // Gate on the key before serving cache or fetching analytics.
      const keyPresent =
        (await window.electronAPI.hasProvisioningKey?.("openrouter")) ?? false;
      if (!isLatestRequest()) return;
      commitHasKey(keyPresent);
      if (!keyPresent) {
        commitData(null);
        setLoading(false);
        return;
      }

      if (!force && cached) {
        commitData(cached.data);
      }

      if (!force && cached?.fresh) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const result = await requestUsageData({
          key: cacheKey,
          load: () => window.electronAPI.getOpenRouterAnalytics(range),
          now,
          force,
        });
        if (!isLatestRequest()) return;
        commitData(result);
        commitHasKey(result.hasKey);
      } catch (error) {
        // Degrade quietly; the panel renders per-card unavailable states.
        console.error("OpenRouter analytics fetch failed", error);
      } finally {
        if (isLatestRequest()) setLoading(false);
      }
    },
    [profileId, range, now],
  );

  // Fetch on mount + whenever the range changes (cache may serve it instantly).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IPC synchronization owns the hook's loading/data state.
    void load(false);
    // Discard whatever is in flight when the range changes or the tab closes.
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const refresh = useCallback((): void => {
    void load(true);
  }, [load]);

  return {
    data: dataState.profileId === profileId ? dataState.value : null,
    loading,
    hasKey: keyState.profileId === profileId ? keyState.value : null,
    refresh,
  };
};
