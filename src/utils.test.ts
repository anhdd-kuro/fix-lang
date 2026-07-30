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

/**
 * `getHighlightedText` passes an options object, so the callback is `exec`'s
 * THIRD argument. Driving it positionally broke every test in this file the
 * moment a `timeout` was added, so pick the callback out by type instead.
 */
const execCallbackOf = (args: unknown[]): ExecCallback =>
  args.find((arg): arg is ExecCallback => typeof arg === "function") as ExecCallback;

/** Drives the mocked `osascript` to fail with `error`, leaving the clipboard as-is. */
const copyFailingWith = (error: Error, stdout = ""): void => {
  execMock.mockImplementation((...args: unknown[]) => {
    execCallbackOf(args)(error, stdout);
  });
};

const originalPlatform = process.platform;

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
};

/**
 * The app HONOURS the synthesized ⌘C: it writes the selection onto the
 * pasteboard, and only then does the script's `return the clipboard` read it
 * back. Simulating the pasteboard write is what makes this harness able to tell
 * an honoured copy from a swallowed one — `getHighlightedText` decides whether
 * its `finally` is a restore or a blanking by reading the pasteboard, so a mock
 * whose `exec` left `clipboardState` untouched would report every copy as
 * swallowed.
 */
const copyResolvingWith = (stdout: string): void => {
  execMock.mockImplementation((...args: unknown[]) => {
    clipboardState.text = stdout;
    clipboardState.formats = ["text/plain"];
    execCallbackOf(args)(null, stdout);
  });
};

/**
 * The app IGNORES the ⌘C (terminals under some configurations, apps mid-modal).
 * The pasteboard keeps whatever it held, and `return the clipboard` hands that
 * back — a text clipboard verbatim, a non-text one as an AppleScript raw-data
 * literal.
 */
const copySwallowedReturning = (stdout: string): void => {
  execMock.mockImplementation((...args: unknown[]) => {
    execCallbackOf(args)(null, stdout);
  });
};

describe("getHighlightedText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
    clipboardState.formats = ["public.utf8-plain-text"];
  });

  it("maps a keystroke-permission denial to AccessibilityPermissionError", async () => {
    copyFailingWith(new Error(REAL_DENIAL_MESSAGE));

    await expect(getHighlightedText()).rejects.toBeInstanceOf(AccessibilityPermissionError);
  });

  it("passes an unrelated osascript failure through unchanged", async () => {
    const unrelated = new Error(
      "31:45: execution error: System Events got an error: Some application isn't running. (-600)",
    );
    copyFailingWith(unrelated);

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

  it("leaves the clipboard untouched when the failure is a permission denial", async () => {
    copyFailingWith(new Error(REAL_DENIAL_MESSAGE));

    await expect(getHighlightedText()).rejects.toBeInstanceOf(AccessibilityPermissionError);
    // A copy that never happened has nothing to undo, so the snapshot is not
    // written back — the clipboard simply still holds what it held.
    expect(clipboardState.text).toBe("previous clipboard content");
    expect(writeTextMock).not.toHaveBeenCalled();
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
    copyFailingWith(
      new Error("31:45: execution error: something went wrong. (-600)"),
      "leaked selection",
    );

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
    copySwallowedReturning("previous clipboard content\n");

    await expect(getHighlightedText()).resolves.toBe("");
  });

  it("treats an unchanged clipboard as a miss even when the snapshot had surrounding whitespace", async () => {
    clipboardState.text = "  previous clipboard content \n";
    copySwallowedReturning("previous clipboard content");

    await expect(getHighlightedText()).resolves.toBe("");
  });

  it("returns a genuine selection that differs from the previous clipboard", async () => {
    copyResolvingWith("freshly selected text\n");

    await expect(getHighlightedText()).resolves.toBe("freshly selected text");
    expect(writeTextMock).toHaveBeenCalledWith("previous clipboard content");
  });

  // The snapshot comparison alone cannot see this: over an image-only clipboard
  // the snapshot is `""`, so it never equals the osascript output, and
  // `return the clipboard` on a non-text pasteboard prints a raw-data literal.
  // Left unguarded, megabytes of PNG hex reach the provider as "the selection".
  it("reports a swallowed ⌘C over an image-only clipboard as a miss, not raw pasteboard data", async () => {
    clipboardState.text = "";
    clipboardState.formats = ["image/png"];
    copySwallowedReturning("«data PNGf89504E470D0A1A0A0000000D49484452»");

    await expect(getHighlightedText()).resolves.toBe("");
  });

  it("does not blank an image-only clipboard when the ⌘C was swallowed", async () => {
    clipboardState.text = "";
    clipboardState.formats = ["image/png"];
    copySwallowedReturning("«data PNGf89504E470D0A1A0A»");

    await getHighlightedText();
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(clipboardState.formats).toEqual(["image/png"]);
  });

  it("does not blank a non-text clipboard when the copy fails either", async () => {
    clipboardState.text = "";
    clipboardState.formats = ["public.rtf"];
    copyFailingWith(new Error(REAL_DENIAL_MESSAGE));

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

  // `writeText("")` declares an EMPTY TEXT FLAVOUR, so the restore above leaves
  // the pasteboard reporting a format while its text stays `""` — a state
  // FixLang creates for itself on every transform over an empty clipboard. A
  // guard that classified "empty text + any format" as non-text skipped the
  // NEXT run's restore and left the user's selection on the pasteboard for good.
  it("still restores on a second transform, after its own restore left an empty text flavour", async () => {
    clipboardState.text = "";
    clipboardState.formats = [];
    copyResolvingWith("first selection");
    await getHighlightedText();

    // What the real pasteboard looks like now: no text, but a text flavour.
    expect(clipboardState.text).toBe("");
    clipboardState.formats = ["text/plain"];
    writeTextMock.mockClear();

    copyResolvingWith("second selection");
    await expect(getHighlightedText()).resolves.toBe("second selection");
    expect(writeTextMock).toHaveBeenCalledWith("");
    expect(clipboardState.text).toBe("");
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
