/**
 * @file utils.test.ts
 * @description `checkShortcut`/`handleError` are thin wiring around
 * `showErrorNotification` — this only asserts the wiring (which `Error`
 * subclass and catalog key flow through), since `showErrorNotification`'s
 * own localization behavior is already covered end-to-end in
 * `notifications/error.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizedError } from "~/main/notifications/error";
import { checkShortcut, handleError } from "./utils";

const { showErrorNotificationMock } = vi.hoisted(() => ({
  showErrorNotificationMock: vi.fn(),
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
