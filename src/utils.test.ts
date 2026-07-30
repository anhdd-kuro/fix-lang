/**
 * @file utils.test.ts
 * @description Covers the Accessibility-permission-revocation fix:
 * `getHighlightedText` must map a denied-keystroke `osascript` failure to
 * `AccessibilityPermissionError` and leave any other failure unchanged, and
 * `promptAccessibilityPermission` must throttle to at most one dialog per
 * interval. Also covers the combined frontmost-app-read-then-copy variant
 * (`getHighlightedTextWithActiveApp`) and the clipboard-change poll
 * (`waitForClipboardChange`) that replaced the old hardcoded `delay`s.
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
  getHighlightedTextWithActiveApp,
  promptAccessibilityPermission,
  waitForClipboardChange,
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

/**
 * Drives the copy-keystroke `exec` mock the way the real thing behaves:
 * `newClipboardValue`, when given, mutates the mocked clipboard BEFORE the
 * callback fires — standing in for the OS pasteboard write a real Cmd-C
 * triggers "instantly" from the poll's point of view, so the very first
 * `waitForClipboardChange` tick already observes it. That keeps the
 * "selection was copied" tests fast with no fake timers needed. Omitting it
 * simulates Cmd-C being a no-op (nothing selected) — the clipboard never
 * changes.
 */
const mockCopyExec = ({
  error = null,
  stdout = "",
  newClipboardValue,
}: {
  error?: Error | null;
  stdout?: string;
  newClipboardValue?: string;
}): void => {
  execMock.mockImplementation(
    // `exec` is called both ways in `src/utils.ts`: plain
    // `exec(cmd, callback)` for the bare keystrokes, and
    // `exec(cmd, { timeout }, callback)` for the combined frontmost-app read,
    // which must be bounded so a hung System Events cannot block the copy.
    // Resolving the callback positionally keeps this mock honest for both
    // instead of silently receiving the options object as its callback.
    (_cmd: string, optionsOrCallback: unknown, maybeCallback?: ExecCallback) => {
      const callback =
        typeof optionsOrCallback === "function"
          ? (optionsOrCallback as ExecCallback)
          : (maybeCallback as ExecCallback);
      if (!error && newClipboardValue !== undefined) {
        clipboardState.text = newClipboardValue;
      }
      callback(error, stdout);
    },
  );
};

describe("getHighlightedText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps a keystroke-permission denial to AccessibilityPermissionError", async () => {
    mockCopyExec({ error: new Error(REAL_DENIAL_MESSAGE) });

    await expect(getHighlightedText()).rejects.toBeInstanceOf(AccessibilityPermissionError);
  });

  it("passes an unrelated osascript failure through unchanged", async () => {
    const unrelated = new Error(
      "31:45: execution error: System Events got an error: Some application isn't running. (-600)",
    );
    mockCopyExec({ error: unrelated });

    expect.assertions(3);
    try {
      await getHighlightedText();
    } catch (error) {
      expect(error).not.toBeInstanceOf(AccessibilityPermissionError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Failed to get highlighted text");
    }
  });

  it("restores the clipboard even when the failure is a permission denial", async () => {
    mockCopyExec({ error: new Error(REAL_DENIAL_MESSAGE) });

    await expect(getHighlightedText()).rejects.toBeInstanceOf(AccessibilityPermissionError);
    expect(clipboardState.text).toBe("previous clipboard content");
  });

  it("returns the new selection when the copy keystroke changes the clipboard", async () => {
    mockCopyExec({ newClipboardValue: "the user's real selection" });

    await expect(getHighlightedText()).resolves.toBe("the user's real selection");
  });

  it("falls back to the (unchanged) clipboard content, NOT \"\", when the clipboard never changes", async () => {
    // Strict path gains no stale-clipboard protection from the poll: an
    // unchanged clipboard here is indistinguishable from a genuine
    // re-selection of text byte-identical to what was already on the
    // clipboard (copy a paragraph, paste it, select it again, hit a
    // transform hotkey), so it must fall back to the clipboard's own content
    // — exactly like the pre-poll implementation — instead of aborting a
    // real selection with "no text selected".
    vi.useFakeTimers();
    mockCopyExec({}); // Cmd-C fires but the pasteboard value never changes

    const pending = getHighlightedText();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe("previous clipboard content");
  });

  it("falls back to the (unchanged) clipboard content on a poll timeout, even if the clipboard eventually changes too late", async () => {
    vi.useFakeTimers();
    mockCopyExec({});
    // Lands well after the poll's timeout, so the poll never observes it.
    setTimeout(() => {
      clipboardState.text = "arrived too late";
    }, 3_100);

    const pending = getHighlightedText();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe("previous clipboard content");
  });

  it("restores the clipboard after a successful read", async () => {
    mockCopyExec({ newClipboardValue: "the user's real selection" });

    await getHighlightedText();

    expect(clipboardState.text).toBe("previous clipboard content");
  });
});

describe("getHighlightedTextForOptionalContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns \"\" when the copy did not change the clipboard (nothing selected: Cmd-C was a no-op)", async () => {
    // Reproduces finding 07/f1: with nothing selected, the Cmd-C keystroke is
    // a no-op and the clipboard still holds whatever was there before — here,
    // a password-manager-style secret that must never be reported as "the
    // selection".
    vi.useFakeTimers();
    clipboardState.text = "hunter2-super-secret-password";
    mockCopyExec({});

    const pending = getHighlightedTextForOptionalContext();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe("");
  });

  it("settles the no-change case fast — Ask AI's empty selection is the NORMAL path, not a 3s stall", async () => {
    // `waitForClipboardChange`'s own default is 3s. Inheriting it here meant
    // the Ask AI hotkey sat unresponsive for three seconds before its input
    // window opened, every single time nothing was selected — worse than the
    // ~200ms of fixed `delay` the poll replaced. Advancing only 600ms proves
    // the timeout is explicitly bounded: at the 3s default this promise would
    // still be pending here.
    vi.useFakeTimers();
    mockCopyExec({});

    const pending = getHighlightedTextForOptionalContext();
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toBe("");
  });

  it("returns the new selection when the copy changed the clipboard", async () => {
    mockCopyExec({ newClipboardValue: "the user's real selection" });

    await expect(getHighlightedTextForOptionalContext()).resolves.toBe(
      "the user's real selection",
    );
  });

  it("documents the accepted false negative: a real selection byte-identical to the clipboard also resolves to \"\"", async () => {
    // Intentional trade-off, not a bug: context is optional for this
    // caller, so reporting "no selection" here only costs a missing context
    // block, versus the alternative of leaking an unrelated clipboard as if
    // it were the selection.
    vi.useFakeTimers();
    clipboardState.text = "same text on both sides";
    mockCopyExec({}); // Cmd-C fires but the pasteboard value never observably changes

    const pending = getHighlightedTextForOptionalContext();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe("");
  });

  it("maps a keystroke-permission denial to AccessibilityPermissionError, same as getHighlightedText", async () => {
    mockCopyExec({ error: new Error(REAL_DENIAL_MESSAGE) });

    await expect(getHighlightedTextForOptionalContext()).rejects.toBeInstanceOf(
      AccessibilityPermissionError,
    );
  });

  it("restores the clipboard after a successful read", async () => {
    mockCopyExec({ newClipboardValue: "the user's real selection" });

    await getHighlightedTextForOptionalContext();

    expect(clipboardState.text).toBe("previous clipboard content");
  });
});

describe("getHighlightedTextWithActiveApp — combined frontmost-app + copy read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses the frontmost app from the combined script's stdout alongside the copied text", async () => {
    mockCopyExec({
      stdout: "Slack\tcom.tinyspeck.slackmacgap",
      newClipboardValue: "the user's real selection",
    });

    await expect(getHighlightedTextWithActiveApp()).resolves.toEqual({
      text: "the user's real selection",
      activeApp: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap" },
    });
  });

  it("reports a null activeApp for an unusable frontmost line (FixLang itself), without affecting the copied text", async () => {
    mockCopyExec({
      stdout: "FixLang\tcom.fixlang.app",
      newClipboardValue: "the user's real selection",
    });

    await expect(getHighlightedTextWithActiveApp()).resolves.toEqual({
      text: "the user's real selection",
      activeApp: null,
    });
  });

  it("reports a null activeApp for a totally empty combined-script stdout, without aborting the copy", async () => {
    mockCopyExec({ stdout: "", newClipboardValue: "some selection" });

    await expect(getHighlightedTextWithActiveApp()).resolves.toEqual({
      text: "some selection",
      activeApp: null,
    });
  });

  it("still copies when the combined frontmost-app read fails, reporting a null activeApp", async () => {
    // A hung or failing System Events lookup must cost only the app-context
    // block. The lookup runs BEFORE the keystroke inside the combined script,
    // so without a plain-keystroke retry a beachballed frontmost app would
    // take the whole transform down with it.
    let call = 0;
    execMock.mockImplementation(
      (_cmd: string, optionsOrCallback: unknown, maybeCallback?: ExecCallback) => {
        const callback =
          typeof optionsOrCallback === "function"
            ? (optionsOrCallback as ExecCallback)
            : (maybeCallback as ExecCallback);
        call += 1;
        if (call === 1) {
          // The combined script, as `exec` reports a timeout kill.
          callback(new Error("Command failed: osascript ... ETIMEDOUT"), "");
          return;
        }
        // The plain-keystroke retry succeeds and lands the selection.
        clipboardState.text = "the user's real selection";
        callback(null, "");
      },
    );

    await expect(getHighlightedTextWithActiveApp()).resolves.toEqual({
      text: "the user's real selection",
      activeApp: null,
    });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("bounds the combined script with a timeout so a hung lookup cannot hang the copy", async () => {
    mockCopyExec({ stdout: "Slack\tcom.tinyspeck.slackmacgap", newClipboardValue: "sel" });

    await getHighlightedTextWithActiveApp();

    const [, options] = execMock.mock.calls[0];
    expect(options).toMatchObject({ timeout: expect.any(Number) });
    expect((options as { timeout: number }).timeout).toBeGreaterThan(0);
  });

  it("fires the callback right after the script returns, before the clipboard-change poll resolves", async () => {
    const order: string[] = [];
    mockCopyExec({ stdout: "Slack\tcom.tinyspeck.slackmacgap" });

    const onScriptComplete = vi.fn(() => {
      order.push("callback");
    });

    const pending = getHighlightedTextWithActiveApp(onScriptComplete).then((result) => {
      order.push("resolved");
      return result;
    });

    // Land the clipboard change shortly after the callback fires — well
    // inside the poll's timeout — so the whole promise settles quickly
    // instead of needing to fast-forward the default 3s timeout.
    setTimeout(() => {
      clipboardState.text = "the real selection";
    }, 20);

    await pending;

    expect(order).toEqual(["callback", "resolved"]);
  });

  it("falls back to the (unchanged) clipboard content, NOT \"\", when the clipboard never changes, keeping the parsed activeApp", async () => {
    // Same strict fallback as getHighlightedText (see its doc comment): this
    // stands in for that function at the correction hotkey's ordinary preset
    // call site, so it must not regress a genuine re-selection of text
    // byte-identical to the clipboard into a false "no text selected" abort.
    vi.useFakeTimers();
    clipboardState.text = "previous clipboard content";
    mockCopyExec({ stdout: "Slack\tcom.tinyspeck.slackmacgap" });

    const pending = getHighlightedTextWithActiveApp();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toEqual({
      text: "previous clipboard content",
      activeApp: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap" },
    });
  });

  it("maps a keystroke-permission denial to AccessibilityPermissionError", async () => {
    mockCopyExec({ error: new Error(REAL_DENIAL_MESSAGE) });

    await expect(getHighlightedTextWithActiveApp()).rejects.toBeInstanceOf(
      AccessibilityPermissionError,
    );
  });

  it("restores the clipboard even on failure", async () => {
    mockCopyExec({ error: new Error(REAL_DENIAL_MESSAGE) });

    await expect(getHighlightedTextWithActiveApp()).rejects.toBeInstanceOf(
      AccessibilityPermissionError,
    );
    expect(clipboardState.text).toBe("previous clipboard content");
  });
});

describe("waitForClipboardChange", () => {
  beforeEach(() => {
    clipboardState.text = "old value";
  });

  it("resolves immediately when the clipboard has already changed", async () => {
    clipboardState.text = "new value";

    await expect(
      waitForClipboardChange({ oldValue: "old value", timeout: 5_000, interval: 5 }),
    ).resolves.toBe("new value");
  });

  it("keeps polling until a later change lands, within the timeout", async () => {
    const pending = waitForClipboardChange({
      oldValue: "old value",
      timeout: 200,
      interval: 5,
    });

    setTimeout(() => {
      clipboardState.text = "changed later";
    }, 20);

    await expect(pending).resolves.toBe("changed later");
  });

  it("returns oldValue unchanged when the clipboard never changes before the timeout", async () => {
    await expect(
      waitForClipboardChange({ oldValue: "old value", timeout: 30, interval: 5 }),
    ).resolves.toBe("old value");
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
