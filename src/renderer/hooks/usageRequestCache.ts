import type { ProviderId } from "~/shared/providers";
import type { UsageRange } from "~/shared/usage";

export const USAGE_CACHE_TTL_MS = 60_000;

export type UsageCacheKey = {
  profileId: string;
  provider: Extract<ProviderId, "openai" | "openrouter">;
  range: UsageRange;
};

type CacheEntry = {
  stampedAt: number;
  data: unknown;
};

type ProfileCache = Map<string, CacheEntry>;
type ProfileRequests = Map<string, Promise<unknown>>;

const cacheByProfile = new Map<string, ProfileCache>();
const requestsByProfile = new Map<string, ProfileRequests>();
const profileGenerations = new Map<string, number>();

const requestKey = ({ provider, range }: UsageCacheKey): string =>
  `${provider}:${range}`;

const generationFor = (profileId: string): number =>
  profileGenerations.get(profileId) ?? 0;

export const cacheIsFresh = (
  stampedAt: number,
  now: number,
  ttlMs: number = USAGE_CACHE_TTL_MS,
): boolean => now - stampedAt < ttlMs;

export const readUsageCache = <T>(
  key: UsageCacheKey,
  now: number,
  ttlMs: number = USAGE_CACHE_TTL_MS,
): { data: T; fresh: boolean } | null => {
  const entry = cacheByProfile.get(key.profileId)?.get(requestKey(key));
  if (!entry) return null;
  return {
    data: entry.data as T,
    fresh: cacheIsFresh(entry.stampedAt, now, ttlMs),
  };
};

export const requestUsageData = <T>({
  key,
  load,
  now = Date.now,
  force = false,
  ttlMs = USAGE_CACHE_TTL_MS,
}: {
  key: UsageCacheKey;
  load: () => Promise<T>;
  now?: () => number;
  force?: boolean;
  ttlMs?: number;
}): Promise<T> => {
  const cached = readUsageCache<T>(key, now(), ttlMs);
  if (!force && cached?.fresh) return Promise.resolve(cached.data);

  const keyWithinProfile = requestKey(key);
  const profileRequests =
    requestsByProfile.get(key.profileId) ?? new Map<string, Promise<unknown>>();
  requestsByProfile.set(key.profileId, profileRequests);

  const inFlight = profileRequests.get(keyWithinProfile);
  if (inFlight) return inFlight as Promise<T>;

  const generation = generationFor(key.profileId);
  const request = load().then((data) => {
    if (generationFor(key.profileId) === generation) {
      const profileCache =
        cacheByProfile.get(key.profileId) ?? new Map<string, CacheEntry>();
      cacheByProfile.set(key.profileId, profileCache);
      profileCache.set(keyWithinProfile, { stampedAt: now(), data });
    }
    return data;
  });

  profileRequests.set(keyWithinProfile, request);
  const removeFinishedRequest = (): void => {
    if (profileRequests.get(keyWithinProfile) === request) {
      profileRequests.delete(keyWithinProfile);
      if (profileRequests.size === 0) requestsByProfile.delete(key.profileId);
    }
  };
  void request.then(removeFinishedRequest, removeFinishedRequest);
  return request;
};

export const invalidateUsageCacheForProfile = (profileId: string): void => {
  cacheByProfile.delete(profileId);
  requestsByProfile.delete(profileId);
  profileGenerations.set(profileId, generationFor(profileId) + 1);
};

export const invalidateAllUsageCaches = (): void => {
  const profileIds = new Set([
    ...cacheByProfile.keys(),
    ...requestsByProfile.keys(),
    ...profileGenerations.keys(),
  ]);
  for (const profileId of profileIds) invalidateUsageCacheForProfile(profileId);
};

type UsageCacheInvalidationEvents = {
  onSettingsUpdated?: (callback: () => void) => (() => void) | undefined;
  onActiveProfileChanged?: (callback: () => void) => (() => void) | undefined;
};

export const subscribeToUsageCacheInvalidation = (
  events: UsageCacheInvalidationEvents,
): (() => void) => {
  const offSettings = events.onSettingsUpdated?.(invalidateAllUsageCaches);
  const offProfile = events.onActiveProfileChanged?.(invalidateAllUsageCaches);
  return () => {
    offSettings?.();
    offProfile?.();
  };
};

export const resetUsageCacheForTests = (): void => {
  cacheByProfile.clear();
  requestsByProfile.clear();
  profileGenerations.clear();
};
