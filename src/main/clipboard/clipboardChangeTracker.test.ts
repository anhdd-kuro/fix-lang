/**
 * @file clipboardChangeTracker.test.ts
 * @description Electron-driver tests for the 1 Hz clipboard poll.
 *
 * TRAP, read this before touching fake timers in this file:
 * `vi.useFakeTimers()` must leave `Date` MOCKED — that is its default, so
 * plain `vi.useFakeTimers()` (never `{ toFake: [...] }` without `"Date"` in
 * the list) is what every test below uses. If `Date` were excluded from the
 * faked set, `setInterval`'s callback would still fire on the fake clock,
 * but `Date.now()` inside the observer would keep returning real wall-clock
 * time that never advances relative to `vi.setSystemTime` jumps — every age
 * would read `0` and every assertion below would pass while proving
 * nothing. This is the exact same class of failure as the autocomplete
 * cache-eviction test elsewhere in this repo: a fake-timer test that looks
 * green because the clock it depends on was quietly left real.
 *
 * The module under test is a singleton (one system clipboard), so every
 * test loads a fresh module graph via `vi.resetModules()` + dynamic
 * `import()` — otherwise the interval handle and wiring flags from one test
 * would leak into the next, matching the idiom in
 * `src/main/llm/prewarm.test.ts` / `ai.request/model-display-cache.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

const { readTextMock, powerMonitorOnMock, powerMonitorHandlers } = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  return {
    readTextMock: vi.fn<() => string>(),
    powerMonitorHandlers: handlers,
    powerMonitorOnMock: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
    }),
  };
});

vi.mock("electron", () => ({
  clipboard: { readText: readTextMock },
  powerMonitor: { on: powerMonitorOnMock },
}));

const settingsWith = (clipboardMaxAgeSeconds: number): SelectionGuardSettings => ({
  clipboardMaxAgeSeconds,
  maxSelectionChars: 20_000,
  deniedBundleIds: [],
});

describe("clipboardChangeTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    readTextMock.mockReset();
    powerMonitorOnMock.mockClear();
    powerMonitorHandlers.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("never schedules the interval and never reads the clipboard when clipboardMaxAgeSeconds is 0", async () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const tracker = await import("./clipboardChangeTracker");

    tracker.applySettings(settingsWith(0));
    vi.advanceTimersByTime(10_000);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(readTextMock).not.toHaveBeenCalled();
    expect(tracker.ageMs()).toBeNull();
  });

  it("start() alone never arms the interval before any settings have been applied (maxAgeSeconds defaults to 0)", async () => {
    // Exercises armIntervalIfNeeded()'s own `maxAgeSeconds <= 0` guard
    // directly — applySettings() is never called here, so its early return
    // is not the thing standing between this call and the interval.
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const tracker = await import("./clipboardChangeTracker");

    tracker.start();
    vi.advanceTimersByTime(10_000);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(readTextMock).not.toHaveBeenCalled();
  });

  it("stops polling immediately when settings transition from non-zero to 0", async () => {
    const tracker = await import("./clipboardChangeTracker");

    readTextMock.mockReturnValue("some text");
    tracker.applySettings(settingsWith(5));
    vi.advanceTimersByTime(1_000);
    expect(readTextMock).toHaveBeenCalledTimes(1);

    readTextMock.mockClear();
    tracker.applySettings(settingsWith(0));
    vi.advanceTimersByTime(10_000);
    expect(readTextMock).not.toHaveBeenCalled();
  });

  it("never calls clipboard.readText() inside a beginSelfManagedRead/endSelfManagedRead window", async () => {
    const tracker = await import("./clipboardChangeTracker");

    readTextMock.mockReturnValue("outside the window");
    tracker.applySettings(settingsWith(5));
    vi.advanceTimersByTime(1_000);
    expect(readTextMock).toHaveBeenCalledTimes(1);

    readTextMock.mockClear();
    tracker.beginSelfManagedRead();
    vi.advanceTimersByTime(3_000); // 3 ticks would fire if not suspended
    expect(readTextMock).not.toHaveBeenCalled();

    tracker.endSelfManagedRead("outside the window");
    vi.advanceTimersByTime(1_000);
    expect(readTextMock).toHaveBeenCalledTimes(1);
  });

  it("reports an 8-hour-old clipboard across a powerMonitor suspend/resume, not 0", async () => {
    const tracker = await import("./clipboardChangeTracker");

    tracker.applySettings(settingsWith(5));

    readTextMock.mockReturnValue("before sleep — baseline");
    vi.advanceTimersByTime(1_000); // first sighting: baseline only
    expect(tracker.ageMs()).toBeNull();

    readTextMock.mockReturnValue("before sleep — changed");
    vi.advanceTimersByTime(1_000); // genuine change
    expect(tracker.ageMs()).toBe(0);

    const suspend = powerMonitorHandlers.get("suspend");
    const resume = powerMonitorHandlers.get("resume");
    expect(suspend).toBeDefined();
    expect(resume).toBeDefined();

    suspend?.();

    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1_000;
    vi.setSystemTime(new Date(Date.now() + EIGHT_HOURS_MS));
    resume?.();

    // Immediately on wake, before any new poll: age already reflects the
    // real elapsed time because it is computed from the clock, not ticks.
    expect(tracker.ageMs()).toBe(EIGHT_HOURS_MS);

    // The clipboard is unchanged across the sleep, so the next real poll
    // must not reset lastChangedAt back toward 0.
    vi.advanceTimersByTime(1_000);
    expect(tracker.ageMs()).toBe(EIGHT_HOURS_MS + 1_000);
  });

  it("pauses the poll on suspend so it does not read the clipboard while the machine is asleep", async () => {
    const tracker = await import("./clipboardChangeTracker");

    readTextMock.mockReturnValue("steady");
    tracker.applySettings(settingsWith(5));
    vi.advanceTimersByTime(1_000);

    const suspend = powerMonitorHandlers.get("suspend");
    suspend?.();

    readTextMock.mockClear();
    vi.advanceTimersByTime(5_000);
    expect(readTextMock).not.toHaveBeenCalled();
  });
});
