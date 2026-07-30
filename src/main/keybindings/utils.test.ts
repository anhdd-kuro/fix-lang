/**
 * @file utils.test.ts
 * @description `checkShortcut`/`handleError` are thin wiring around
 * `showErrorNotification` — this only asserts the wiring (which `Error`
 * subclass and catalog key flow through), since `showErrorNotification`'s
 * own localization behavior is already covered end-to-end in
 * `notifications/error.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityPermissionError, LocalizedError } from "~/main/notifications/error";
import {
  checkShortcut,
  handleError,
  HOTKEY_IN_FLIGHT_STALE_MS,
  HOTKEY_THROTTLE_MS,
  resetHotkeyThrottleForTests,
  withHotkeyThrottle,
} from "./utils";

const { showErrorNotificationMock, promptAccessibilityPermissionMock } = vi.hoisted(() => ({
  showErrorNotificationMock: vi.fn(),
  promptAccessibilityPermissionMock: vi.fn(),
}));

// `handleError` now also imports `~/utils` for `promptAccessibilityPermission`.
// The real module talks to `child_process`/Electron `dialog` — irrelevant to
// what this file tests (wiring only) and already covered end-to-end in
// `~/utils.test.ts` — so it is mocked out entirely here.
vi.mock("~/utils", () => ({
  promptAccessibilityPermission: promptAccessibilityPermissionMock,
}));

// `~/main/notifications/error` imports `mainT` (reads `~/stores/localeStore`)
// and `showErrorPopup` (transitively reads `themeStore`) — both backed by
// real `electron-store`, which throws without a `projectName` in a test
// environment. Mock both directly — same pattern as
// `correctionNotifications.test.ts` / `error.test.ts` — so this file never
// touches the filesystem or real Electron `app`.
vi.mock("~/stores/localeStore", () => ({
  getLocale: vi.fn().mockReturnValue("en"),
}));

vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));

vi.mock("~/main/notifications/error", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.importOriginal returns unknown module shape (same pattern as correction-preset-options.test.ts)
  const real = await importOriginal<any>();
  return {
    ...real,
    showErrorNotification: showErrorNotificationMock,
  };
});

describe("handleError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the error straight through with no fallback-message override", () => {
    const error = new Error("boom");

    handleError(error);

    // Only one argument reaches `showErrorNotification` — the previous
    // hardcoded English literal ("Failed to correct text...") is gone, so
    // `showErrorNotification` falls back to its own localized default
    // instead (see notifications/error.test.ts for that behavior).
    expect(showErrorNotificationMock).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("does not prompt for Accessibility permission on an unrelated error", () => {
    handleError(new Error("boom"));

    expect(promptAccessibilityPermissionMock).not.toHaveBeenCalled();
  });

  it("also triggers the actionable Accessibility prompt for AccessibilityPermissionError", () => {
    const error = new AccessibilityPermissionError();

    handleError(error);

    // Still reported as a notification (localized body covered end-to-end in
    // notifications/error.test.ts) *and* triggers the dialog — a mid-session
    // revocation would otherwise only ever surface as a notification, which
    // the observed log shows can itself fail (`UNErrorDomain error 1`).
    expect(showErrorNotificationMock).toHaveBeenCalledExactlyOnceWith(error);
    expect(promptAccessibilityPermissionMock).toHaveBeenCalledOnce();
  });
});

describe("checkShortcut", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports failure via a LocalizedError keyed to the catalog, not a plain Error", () => {
    const result = checkShortcut(false);

    expect(result).toBe(false);
    expect(showErrorNotificationMock).toHaveBeenCalledOnce();
    const [reportedError] = showErrorNotificationMock.mock.calls[0] as [unknown];
    expect(reportedError).toBeInstanceOf(LocalizedError);
    expect((reportedError as LocalizedError).messageKey).toBe(
      "notifications.error.hotkeyRegistrationFailed.body",
    );
  });

  it("does not report an error on success", () => {
    const result = checkShortcut(true);

    expect(result).toBe(true);
    expect(showErrorNotificationMock).not.toHaveBeenCalled();
  });
});


describe("withHotkeyThrottle", () => {
  beforeEach(() => {
    resetHotkeyThrottleForTests();
  });

  it("invokes the handler on the first press", () => {
    const clock = 1_000;
    const handler = vi.fn();
    const throttled = withHotkeyThrottle("Control+Shift+D", handler, () => clock);

    throttled();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores a second press of the same accelerator within 500ms", () => {
    let clock = 1_000;
    const handler = vi.fn();
    const throttled = withHotkeyThrottle("Control+Shift+D", handler, () => clock);

    throttled();
    clock += HOTKEY_THROTTLE_MS - 1;
    throttled();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("invokes again after the 500ms window", () => {
    let clock = 1_000;
    const handler = vi.fn();
    const throttled = withHotkeyThrottle("Control+Shift+D", handler, () => clock);

    throttled();
    clock += HOTKEY_THROTTLE_MS;
    throttled();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not let one accelerator throttle a different accelerator", () => {
    let clock = 1_000;
    const first = vi.fn();
    const second = vi.fn();
    const throttledFirst = withHotkeyThrottle("Control+Shift+D", first, () => clock);
    const throttledSecond = withHotkeyThrottle("Control+Shift+S", second, () => clock);

    throttledFirst();
    clock += 50;
    throttledSecond();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  // The time window alone cannot stop recursion. A user may bind Command+C to
  // a preset (`validateHotkeys` has no reserved-system-key list), and the
  // handler synthesizes ⌘C itself — now behind `getActiveApp()` plus the AX
  // selection read (1.5s timeout), so the synthesized press can land well
  // outside 500ms and re-enter, each iteration firing another provider request.
  it("refuses re-entry while the same accelerator's handler is still in flight", async () => {
    let clock = 1_000;
    let finishHandler!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHandler = resolve;
        }),
    );
    const throttled = withHotkeyThrottle("Command+C", handler, () => clock);

    const firstRun = throttled();
    // Far outside the time window — only the in-flight guard can refuse this.
    clock += HOTKEY_THROTTLE_MS * 4;
    void throttled();

    expect(handler).toHaveBeenCalledTimes(1);

    finishHandler();
    await firstRun;
    clock += HOTKEY_THROTTLE_MS;
    const secondRun = throttled();

    expect(handler).toHaveBeenCalledTimes(2);

    finishHandler();
    await secondRun;
  });

  // Nothing the guard fences is guaranteed to settle: no provider request sets
  // a timeout or AbortSignal, so a local endpoint that accepts the connection
  // and never answers leaves the handler pending forever. Without a ceiling that
  // one press silences the preset for the rest of the process — no notification,
  // no log line, recovery only by restarting the app.
  it("lets a press through once an unfinished run passes the stale ceiling", async () => {
    let clock = 1_000;
    const neverSettles = vi.fn(() => new Promise<void>(() => undefined));
    const throttled = withHotkeyThrottle("Control+Shift+F", neverSettles, () => clock);

    void throttled();

    clock += HOTKEY_IN_FLIGHT_STALE_MS - 1;
    void throttled();
    expect(neverSettles).toHaveBeenCalledTimes(1);

    clock += 1;
    void throttled();
    expect(neverSettles).toHaveBeenCalledTimes(2);
  });

  // The ceiling must stay far outside a legitimate slow transform: a reasoning
  // model on a long input can run for minutes, and cutting a real run loose to
  // start a second one would double-bill the user. Recursion is the opposite
  // shape — a synthesized ⌘C re-enters within milliseconds.
  it("keeps refusing recursion-speed re-entry, which is what the ceiling must not let through", () => {
    expect(HOTKEY_IN_FLIGHT_STALE_MS).toBeGreaterThanOrEqual(60_000);
  });

  // Once the ceiling has handed the accelerator to a later press, the earlier
  // run finishing must not release the newer one's claim.
  it("does not let a stale run's completion release the press that superseded it", async () => {
    let clock = 1_000;
    // One resolver per invocation: a single `finishStale` variable would be
    // overwritten by the second call and resolve the wrong run.
    const resolvers: (() => void)[] = [];
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const throttled = withHotkeyThrottle("Control+Shift+F", handler, () => clock);

    const staleRun = throttled();
    clock += HOTKEY_IN_FLIGHT_STALE_MS;
    void throttled();
    expect(handler).toHaveBeenCalledTimes(2);

    // The FIRST run settles now. It must not clear the second run's entry.
    resolvers[0]();
    await staleRun;

    clock += HOTKEY_THROTTLE_MS;
    void throttled();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight guard when the handler rejects", async () => {
    let clock = 1_000;
    const failing = vi.fn().mockRejectedValue(new Error("handler failed"));
    const throttled = withHotkeyThrottle("Control+Shift+D", failing, () => clock);

    await expect(throttled()).rejects.toThrow("handler failed");

    // A guard leaked by a failed transform would disable the hotkey until the
    // app restarts — worse than the recursion it prevents.
    clock += HOTKEY_THROTTLE_MS;
    await expect(throttled()).rejects.toThrow("handler failed");
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight guard when the handler throws synchronously", async () => {
    let clock = 1_000;
    const throwing = vi.fn(() => {
      throw new Error("sync boom");
    });
    const throttled = withHotkeyThrottle("Control+Shift+D", throwing, () => clock);

    expect(() => throttled()).toThrow("sync boom");
    clock += HOTKEY_THROTTLE_MS;
    expect(() => throttled()).toThrow("sync boom");
    expect(throwing).toHaveBeenCalledTimes(2);
  });

  it("does not let one accelerator's in-flight run block a different accelerator", async () => {
    const clock = 1_000;
    let finishFirst!: () => void;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const second = vi.fn().mockResolvedValue(undefined);
    const throttledFirst = withHotkeyThrottle("Control+Shift+D", first, () => clock);
    const throttledSecond = withHotkeyThrottle("Control+Shift+S", second, () => clock);

    const firstRun = throttledFirst();
    await throttledSecond();

    expect(second).toHaveBeenCalledTimes(1);

    finishFirst();
    await firstRun;
  });

  it("resets the in-flight guard for tests", async () => {
    let clock = 1_000;
    const handler = vi.fn(() => new Promise<void>(() => undefined));
    const throttled = withHotkeyThrottle("Command+C", handler, () => clock);

    void throttled();
    resetHotkeyThrottleForTests();
    clock += HOTKEY_THROTTLE_MS;
    void throttled();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("leaves handler success and failure behavior unchanged", async () => {
    let clock = 1_000;
    const success = vi.fn().mockResolvedValue(undefined);
    const failure = vi.fn().mockRejectedValue(new Error("handler failed"));

    await expect(
      withHotkeyThrottle("Control+Shift+D", success, () => clock)(),
    ).resolves.toBeUndefined();
    expect(success).toHaveBeenCalledTimes(1);

    clock += HOTKEY_THROTTLE_MS;
    await expect(
      withHotkeyThrottle("Control+Shift+D", failure, () => clock)(),
    ).rejects.toThrow("handler failed");
    expect(failure).toHaveBeenCalledTimes(1);
  });
});
