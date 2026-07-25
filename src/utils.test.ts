/**
 * @file utils.test.ts
 * @description Covers the Accessibility-permission-revocation fix:
 * `getHighlightedText` must map a denied-keystroke `osascript` failure to
 * `AccessibilityPermissionError` and leave any other failure unchanged, and
 * `promptAccessibilityPermission` must throttle to at most one dialog per
 * interval.
 *
 * `~/utils` now imports `~/main/notifications/error`, which transitively
 * imports `~/main/i18n` (→ `~/stores/localeStore`) and
 * `~/main/webViewWindows/errorPopupWindow` (→ `~/stores/themeStore` + a Vite
 * `?asset` import). Both `localeStore` and `themeStore` instantiate a real
 * `electron-store` `Store` at module scope, which throws ("Please specify
 * the projectName option") without a real Electron `app` — mocking both
 * modules directly, the same pattern `correctionNotifications.test.ts` and
 * `keybindings/utils.test.ts` use, avoids touching Electron or the
 * filesystem at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityPermissionError } from "~/main/notifications/error";
import { getHighlightedText, promptAccessibilityPermission } from "./utils";

const { execMock, showMessageBoxMock, openExternalMock, clipboardState } = vi.hoisted(() => ({
  execMock: vi.fn(),
  showMessageBoxMock: vi.fn(),
  openExternalMock: vi.fn(),
  clipboardState: { text: "previous clipboard content" },
}));

vi.mock("child_process", () => {
  const mockedExports = { exec: execMock, execSync: vi.fn() };
  return { ...mockedExports, default: mockedExports };
});

vi.mock("electron", () => {
  const mockedExports = {
    clipboard: {
      readText: () => clipboardState.text,
      writeText: (value: string) => {
        clipboardState.text = value;
      },
    },
    dialog: {
      showMessageBox: showMessageBoxMock,
      showMessageBoxSync: vi.fn(),
    },
    shell: {
      openExternal: openExternalMock,
    },
  };
  return { ...mockedExports, default: mockedExports };
});

vi.mock("~/stores/localeStore", () => ({
  getLocale: vi.fn().mockReturnValue("en"),
}));

vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));

const REAL_DENIAL_MESSAGE =
  "66:98: execution error: System Events got an error: osascript is not allowed to send keystrokes. (1002)";

type ExecCallback = (error: Error | null, stdout: string) => void;

const originalPlatform = process.platform;

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
};

describe("getHighlightedText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
  });

  it("maps a keystroke-permission denial to AccessibilityPermissionError", async () => {
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(new Error(REAL_DENIAL_MESSAGE), "");
    });

    await expect(getHighlightedText()).rejects.toBeInstanceOf(AccessibilityPermissionError);
  });

  it("passes an unrelated osascript failure through unchanged", async () => {
    const unrelated = new Error(
      "31:45: execution error: System Events got an error: Some application isn't running. (-600)",
    );
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(unrelated, "");
    });

    expect.assertions(4);
    try {
      await getHighlightedText();
    } catch (error) {
      expect(error).not.toBeInstanceOf(AccessibilityPermissionError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Failed to get highlighted text");
      expect((error as Error).cause).toBe(`Error: ${unrelated.message}`);
    }
  });

  it("restores the clipboard even when the failure is a permission denial", async () => {
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(new Error(REAL_DENIAL_MESSAGE), "");
    });

    await expect(getHighlightedText()).rejects.toBeInstanceOf(AccessibilityPermissionError);
    expect(clipboardState.text).toBe("previous clipboard content");
  });
});

describe("promptAccessibilityPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform("darwin");
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("shows exactly one dialog across a rapid burst of calls, and opens Settings only when the user chose to", async () => {
    // Mirrors the observed bug report: four hotkey failures in 31 seconds
    // should not stack four modals — only the first call within the
    // throttle window should actually show a dialog.
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 }).mockResolvedValue({ response: 1 });

    await promptAccessibilityPermission();
    await promptAccessibilityPermission();
    await promptAccessibilityPermission();
    await promptAccessibilityPermission();

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
    expect(openExternalMock).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
  });

  it("does nothing on non-macOS platforms", async () => {
    setPlatform("win32");

    await promptAccessibilityPermission();

    expect(showMessageBoxMock).not.toHaveBeenCalled();
  });
});
