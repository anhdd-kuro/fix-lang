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
