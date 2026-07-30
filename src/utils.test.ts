/**
 * @file utils.test.ts
 * @description Covers the Accessibility-permission-revocation fix:
 * `getHighlightedText` must map a denied-keystroke `osascript` failure to
 * `AccessibilityPermissionError` and leave any other failure unchanged, and
 * `promptAccessibilityPermission` must throttle to at most one dialog per
 * interval.
 *
 * `~/utils` now imports `~/main/notifications/error`, which transitively
 * imports `~/main/i18n` (→ `~/features/i18n/store/localeStore`) and
 * `~/main/webViewWindows/errorPopupWindow` (→ `~/features/theme/store/themeStore` + a Vite
 * `?asset` import). Both `localeStore` and `themeStore` instantiate a real
 * `electron-store` `Store` at module scope, which throws ("Please specify
 * the projectName option") without a real Electron `app` — mocking both
 * modules directly, the same pattern `correctionNotifications.test.ts` and
 * `keybindings/utils.test.ts` use, avoids touching Electron or the
 * filesystem at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityPermissionError } from "~/main/notifications/error";
import {
  getHighlightedText,
  getHighlightedTextForOptionalContext,
  promptAccessibilityPermission,
} from "./utils";

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

vi.mock("~/features/i18n/store/localeStore", () => ({
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

  it("returns the raw clipboard content even when it is unchanged (unaffected by the optional-context comparison)", async () => {
    // Locks in that getHighlightedText's own behaviour was NOT touched by
    // factoring out the shared readSelection() body: it still returns
    // whatever `copyHighlightedText` reports, with no "did the clipboard
    // change" filtering — that filtering lives only in
    // getHighlightedTextForOptionalContext.
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "previous clipboard content");
    });

    await expect(getHighlightedText()).resolves.toBe("previous clipboard content");
  });
});

describe("getHighlightedTextForOptionalContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
  });

  it("returns \"\" when the copy did not change the clipboard (nothing selected: Cmd-C was a no-op)", async () => {
    // Reproduces finding 07/f1: with nothing selected, the AppleScript
    // Cmd-C is a no-op and `the clipboard` still reads back whatever was
    // there before — here, a password-manager-style secret that must never
    // be reported as "the selection".
    clipboardState.text = "hunter2-super-secret-password";
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "hunter2-super-secret-password");
    });

    await expect(getHighlightedTextForOptionalContext()).resolves.toBe("");
  });

  it("returns the new selection when the copy changed the clipboard", async () => {
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "the user's real selection");
    });

    await expect(getHighlightedTextForOptionalContext()).resolves.toBe(
      "the user's real selection",
    );
  });

  it("documents the accepted false negative: a real selection byte-identical to the clipboard also reads as \"\"", async () => {
    // Intentional trade-off, not a bug: context is optional for this
    // caller, so reporting "no selection" here only costs a missing context
    // block, versus the alternative of leaking an unrelated clipboard as if
    // it were the selection.
    clipboardState.text = "same text on both sides";
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "same text on both sides");
    });

    await expect(getHighlightedTextForOptionalContext()).resolves.toBe("");
  });

  it("returns \"\" for an unchanged clipboard whose content has surrounding whitespace", async () => {
    // `copyHighlightedText` returns `stdout.trim()`, so comparing it against a
    // RAW clipboard snapshot never matches when the clipboard content carries
    // leading/trailing whitespace — and a line yanked out of a password
    // manager or a terminal almost always ends in "\n". Both sides must be
    // normalized identically or the leak guard above silently does nothing.
    clipboardState.text = "hunter2-super-secret-password\n";
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "hunter2-super-secret-password\n");
    });

    await expect(getHighlightedTextForOptionalContext()).resolves.toBe("");
  });

  it("returns \"\" for a multiline unchanged clipboard ending in a newline", async () => {
    clipboardState.text = "line one\nline two\n";
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "line one\nline two\n");
    });

    await expect(getHighlightedTextForOptionalContext()).resolves.toBe("");
  });

  it("still reports a real selection when the clipboard differs only after trimming", async () => {
    // The normalization must not over-reach into a false negative: these two
    // are genuinely different strings, so the selection is real.
    clipboardState.text = "  previous clipboard  ";
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "a genuinely different selection\n");
    });

    await expect(getHighlightedTextForOptionalContext()).resolves.toBe(
      "a genuinely different selection",
    );
  });

  it("maps a keystroke-permission denial to AccessibilityPermissionError, same as getHighlightedText", async () => {
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(new Error(REAL_DENIAL_MESSAGE), "");
    });

    await expect(getHighlightedTextForOptionalContext()).rejects.toBeInstanceOf(
      AccessibilityPermissionError,
    );
  });

  it("restores the clipboard after a successful read", async () => {
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(null, "the user's real selection");
    });

    await getHighlightedTextForOptionalContext();

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
