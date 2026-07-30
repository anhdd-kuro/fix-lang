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

const { execMock, showMessageBoxMock, openExternalMock, clipboardState, writeTextMock } =
  vi.hoisted(() => ({
    execMock: vi.fn(),
    showMessageBoxMock: vi.fn(),
    openExternalMock: vi.fn(),
    writeTextMock: vi.fn(),
    clipboardState: {
      text: "previous clipboard content",
      formats: ["public.utf8-plain-text"] as string[],
    },
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
        writeTextMock(value);
        clipboardState.text = value;
      },
      availableFormats: () => clipboardState.formats,
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

/** Drives the mocked `osascript` to succeed with `stdout` as the copied text. */
const copyResolvingWith = (stdout: string): void => {
  execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
    callback(null, stdout);
  });
};

describe("getHighlightedText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
    clipboardState.formats = ["public.utf8-plain-text"];
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

  // `src/main/index.ts` patches `console.log`/`warn`/`error` to append to
  // `~/.fixlang/log/runtime-*.log` — outside `userData`, unrotated, and reached
  // by neither `redactLogMessage` nor `redactLogContext`. Anything this path
  // prints is therefore persisted in plaintext in the user's home directory, so
  // the copied selection must never reach a console call.
  it("never prints the copied selection to the console", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    copyResolvingWith("my confidential selection\n");

    await expect(getHighlightedText()).resolves.toBe("my confidential selection");

    const printed = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => String(arg))
      .join(" ");
    expect(printed).not.toContain("my confidential selection");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("never prints the copied selection to the console on the failure path either", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(new Error("31:45: execution error: something went wrong. (-600)"), "leaked selection");
    });

    await expect(getHighlightedText()).rejects.toThrow("Failed to get highlighted text");

    const printed = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => String(arg))
      .join(" ");
    expect(printed).not.toContain("leaked selection");

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("reports a swallowed ⌘C as a miss instead of returning the previous clipboard", async () => {
    copyResolvingWith("previous clipboard content\n");

    await expect(getHighlightedText()).resolves.toBe("");
  });

  it("treats an unchanged clipboard as a miss even when the snapshot had surrounding whitespace", async () => {
    clipboardState.text = "  previous clipboard content \n";
    copyResolvingWith("previous clipboard content");

    await expect(getHighlightedText()).resolves.toBe("");
  });

  it("returns a genuine selection that differs from the previous clipboard", async () => {
    copyResolvingWith("freshly selected text\n");

    await expect(getHighlightedText()).resolves.toBe("freshly selected text");
  });

  it("does not blank an image-only clipboard whose text snapshot is empty", async () => {
    clipboardState.text = "";
    clipboardState.formats = ["image/png"];
    copyResolvingWith("freshly selected text");

    await expect(getHighlightedText()).resolves.toBe("freshly selected text");
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("does not blank a non-text clipboard when the copy fails either", async () => {
    clipboardState.text = "";
    clipboardState.formats = ["public.rtf"];
    execMock.mockImplementation((_cmd: string, callback: ExecCallback) => {
      callback(new Error(REAL_DENIAL_MESSAGE), "");
    });

    await expect(getHighlightedText()).rejects.toBeInstanceOf(AccessibilityPermissionError);
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("still restores a clipboard that was genuinely empty", async () => {
    clipboardState.text = "";
    clipboardState.formats = [];
    copyResolvingWith("freshly selected text");

    await expect(getHighlightedText()).resolves.toBe("freshly selected text");
    expect(writeTextMock).toHaveBeenCalledWith("");
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
