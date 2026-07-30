import { describe, expect, it, vi } from "vitest";
import { AccessibilityPermissionError } from "~/main/notifications/error";
import { resolveSelectedText } from "./selectionSource";
import type { AxSelectedTextResult } from "~/main/accessibility/selectedText";

// `resolveSelectedText`'s own dependencies (readAx, readClipboard) are never
// mocked below — every test wires them as plain `vi.fn()`, per the module's
// dependency-injection design. These three mocks exist only because
// `~/main/notifications/error` (needed for the real `AccessibilityPermissionError`
// class) transitively imports `~/main/i18n` → `~/stores/localeStore`, which
// instantiates a real `electron-store` `Store` at module scope and throws
// ("Please specify the `projectName` option") without a real Electron `app` —
// the exact same problem `src/utils.test.ts` and
// `src/main/keybindings/utils.test.ts` document and work around identically.
vi.mock("electron", () => ({ app: {}, Notification: vi.fn() }));
vi.mock("~/stores/localeStore", () => ({ getLocale: vi.fn().mockReturnValue("en") }));
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({ showErrorPopup: vi.fn() }));

const axResult = (overrides: Partial<AxSelectedTextResult>): AxSelectedTextResult => ({
  status: "ok",
  role: "",
  selectedText: "",
  permissionDenied: false,
  ...overrides,
});

describe("resolveSelectedText", () => {
  it("returns the accessibility selection and never touches the clipboard", async () => {
    const readAx = vi
      .fn()
      .mockResolvedValue(axResult({ status: "ok", selectedText: "hello world" }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: "hello world", source: "accessibility" });

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("returns AX text byte-identical, not trimmed, when it has surrounding whitespace", async () => {
    const readAx = vi
      .fn()
      .mockResolvedValue(axResult({ status: "ok", selectedText: "  padded text  \n" }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: "  padded text  \n", source: "accessibility" });

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("refuses a secure field even with the fallback enabled, without touching the clipboard", async () => {
    const readAx = vi.fn().mockResolvedValue(axResult({ status: "secure" }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: null, source: null, reason: "secureField" });

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("refuses a secure field with the fallback disabled too", async () => {
    const readAx = vi.fn().mockResolvedValue(axResult({ status: "secure" }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: false }),
    ).resolves.toEqual({ selectedText: null, source: null, reason: "secureField" });

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("refuses a secure field even when it carries non-empty text, without touching the clipboard", async () => {
    // Guards the f4 hoist: `AxSelectedTextResult` is flat, so a producer bug
    // pairing `status: "secure"` with a non-empty `selectedText` (e.g.
    // "hunter2") would still type-check. The secure check must win on
    // `status` alone, before `selectedText` is ever inspected — this test
    // fails if the ok-branch is ever reordered ahead of the secure check
    // again.
    const readAx = vi
      .fn()
      .mockResolvedValue(axResult({ status: "secure", selectedText: "hunter2" }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: null, source: null, reason: "secureField" });

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("reports axEmpty without calling the clipboard when the fallback is disabled (AX empty)", async () => {
    const readAx = vi.fn().mockResolvedValue(axResult({ status: "empty" }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: false }),
    ).resolves.toEqual({ selectedText: null, source: null, reason: "axEmpty" });

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("reports axEmpty without calling the clipboard when the fallback is disabled (AX unavailable)", async () => {
    const readAx = vi.fn().mockResolvedValue(axResult({ status: "unavailable" }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: false }),
    ).resolves.toEqual({ selectedText: null, source: null, reason: "axEmpty" });

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when AX is empty and the fallback is enabled", async () => {
    const readAx = vi.fn().mockResolvedValue(axResult({ status: "empty" }));
    const readClipboard = vi.fn().mockResolvedValue("clipboard text");

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: "clipboard text", source: "clipboard" });

    expect(readClipboard).toHaveBeenCalledTimes(1);
  });

  it("reports clipboardEmpty when AX is unavailable and the clipboard fallback returns nothing", async () => {
    const readAx = vi.fn().mockResolvedValue(axResult({ status: "unavailable" }));
    const readClipboard = vi.fn().mockResolvedValue("");

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: null, source: null, reason: "clipboardEmpty" });
  });

  it("falls through to the clipboard when AX text is whitespace-only", async () => {
    const readAx = vi
      .fn()
      .mockResolvedValue(axResult({ status: "ok", selectedText: "   \n\t  " }));
    const readClipboard = vi.fn().mockResolvedValue("real text");

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: "real text", source: "clipboard" });

    expect(readClipboard).toHaveBeenCalledTimes(1);
  });

  it("propagates AccessibilityPermissionError thrown by readClipboard unchanged", async () => {
    const readAx = vi.fn().mockResolvedValue(axResult({ status: "empty" }));
    const permissionError = new AccessibilityPermissionError();
    const readClipboard = vi.fn().mockRejectedValue(permissionError);

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).rejects.toBeInstanceOf(AccessibilityPermissionError);
    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).rejects.toBe(permissionError);
  });

  it("throws AccessibilityPermissionError when AX permission is denied and the fallback is disabled", async () => {
    const readAx = vi
      .fn()
      .mockResolvedValue(axResult({ status: "unavailable", permissionDenied: true }));
    const readClipboard = vi.fn();

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: false }),
    ).rejects.toBeInstanceOf(AccessibilityPermissionError);

    expect(readClipboard).not.toHaveBeenCalled();
  });

  it("does not throw when AX permission is denied but the fallback is enabled, and runs the clipboard attempt", async () => {
    const readAx = vi
      .fn()
      .mockResolvedValue(axResult({ status: "unavailable", permissionDenied: true }));
    const readClipboard = vi.fn().mockResolvedValue("fallback text");

    await expect(
      resolveSelectedText({ readAx, readClipboard, clipboardFallbackEnabled: true }),
    ).resolves.toEqual({ selectedText: "fallback text", source: "clipboard" });

    expect(readClipboard).toHaveBeenCalledTimes(1);
  });
});
