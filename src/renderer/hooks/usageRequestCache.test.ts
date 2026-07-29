import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateUsageCacheForProfile,
  readUsageCache,
  requestUsageData,
  resetUsageCacheForTests,
  subscribeToUsageCacheInvalidation,
} from "./usageRequestCache";

const OPENAI_7D = {
  profileId: "profile-1",
  provider: "openai",
  range: "7d",
} as const;

describe("usageRequestCache", () => {
  beforeEach(resetUsageCacheForTests);

  it("reuses data for the same provider, profile, and range within 60s", async () => {
    const load = vi.fn().mockResolvedValue({ total: 12 });

    await requestUsageData({ key: OPENAI_7D, load, now: () => 1_000 });
    const result = await requestUsageData({
      key: OPENAI_7D,
      load,
      now: () => 60_999,
    });

    expect(result).toEqual({ total: 12 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps providers, profiles, and ranges isolated", async () => {
    const load = vi.fn().mockImplementation(async () => load.mock.calls.length);
    const variants = [
      OPENAI_7D,
      { ...OPENAI_7D, range: "30d" as const },
      { ...OPENAI_7D, provider: "openrouter" as const },
      { ...OPENAI_7D, profileId: "profile-2" },
    ];

    await Promise.all(
      variants.map((key) => requestUsageData({ key, load, now: () => 1_000 })),
    );

    expect(load).toHaveBeenCalledTimes(4);
  });

  it("deduplicates an in-flight request, including a forced refresh", async () => {
    let resolve!: (value: { total: number }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ total: number }>((done) => {
          resolve = done;
        }),
    );

    const first = requestUsageData({ key: OPENAI_7D, load });
    const second = requestUsageData({ key: OPENAI_7D, load, force: true });
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ total: 14 });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { total: 14 },
      { total: 14 },
    ]);
  });

  it("explicit refresh bypasses a fresh cached value", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ total: 1 })
      .mockResolvedValueOnce({ total: 2 });

    await requestUsageData({ key: OPENAI_7D, load, now: () => 1_000 });
    const refreshed = await requestUsageData({
      key: OPENAI_7D,
      load,
      force: true,
      now: () => 2_000,
    });

    expect(refreshed).toEqual({ total: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("removes a failed in-flight request so a later mount can retry", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ total: 3 });

    await expect(requestUsageData({ key: OPENAI_7D, load })).rejects.toThrow(
      "temporary",
    );
    await expect(requestUsageData({ key: OPENAI_7D, load })).resolves.toEqual({
      total: 3,
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not let a request repopulate a profile after invalidation", async () => {
    let resolve!: (value: { total: number }) => void;
    const request = requestUsageData({
      key: OPENAI_7D,
      load: () =>
        new Promise<{ total: number }>((done) => {
          resolve = done;
        }),
      now: () => 1_000,
    });

    invalidateUsageCacheForProfile("profile-1");
    resolve({ total: 20 });
    await request;

    expect(readUsageCache(OPENAI_7D, 1_001)).toBeNull();
  });

  it("invalidates cached accounts from the MainWindow lifecycle while provider hooks are absent", async () => {
    await requestUsageData({
      key: OPENAI_7D,
      load: async () => ({ total: 12 }),
      now: () => 1_000,
    });
    let settingsUpdated: (() => void) | undefined;
    const offSettings = vi.fn();
    const offProfile = vi.fn();
    const unsubscribe = subscribeToUsageCacheInvalidation({
      onSettingsUpdated: (callback) => {
        settingsUpdated = callback;
        return offSettings;
      },
      onActiveProfileChanged: () => offProfile,
    });

    settingsUpdated?.();

    expect(readUsageCache(OPENAI_7D, 1_001)).toBeNull();
    unsubscribe();
    expect(offSettings).toHaveBeenCalledOnce();
    expect(offProfile).toHaveBeenCalledOnce();
  });
});
