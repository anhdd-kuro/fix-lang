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
  getAskContext,
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
      // Modelled as "the pasteboard now holds no text", which is what the
      // selection read depends on: it empties the clipboard so the poll that
      // follows asks "did the copy put anything here" instead of "did this
      // value change".
      clear: () => {
        clipboardState.text = "";
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

  it("returns a selection byte-identical to the previous clipboard, instead of reading as \"nothing copied\"", async () => {
    // The workflow the old change-poll could not serve: copy a paragraph,
    // paste it, select that same text again, hit a transform hotkey. The
    // pasteboard value is unchanged from start to finish, so a change-poll saw
    // nothing and the strict path had to fall back to the previous clipboard
    // to avoid aborting a real selection. Emptying the pasteboard first turns
    // it into an ordinary successful copy, so the fallback is not needed.
    mockCopyExec({ newClipboardValue: "previous clipboard content" });

    await expect(getHighlightedText()).resolves.toBe("previous clipboard content");
  });

  it("falls back to the clipboard snapshot when the copy produces nothing", async () => {
    // The fallback is what makes the hotkey work at all on a machine where the
    // synthesized Cmd-C does not reach the frontmost app: the user copies by
    // hand, then presses. Removing it turned every transform into "No text
    // selected" — measured, not theorised.
    vi.useFakeTimers();
    mockCopyExec({});

    const pending = getHighlightedText();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe("previous clipboard content");
  });

  it("falls back to the clipboard snapshot on a poll timeout, even if the copy lands too late", async () => {
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

describe("getAskContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardState.text = "previous clipboard content";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("attaches the clipboard, labelled as such, when the copy produces nothing", async () => {
    // The same clipboard every other preset uses, and the reason Ask AI can
    // use it too: the source travels with the text, so the input window says
    // "From clipboard" over content that may be minutes old instead of
    // presenting it as what the user just highlighted.
    //
    // This deliberately reverses an earlier refusal. Reporting "" here was
    // meant to keep an unrelated clipboard away from the model, but the
    // synthesized Cmd-C fails often enough that the refusal removed the only
    // context the feature ever had — on a real machine's logs, every press.
    vi.useFakeTimers();
    clipboardState.text = "text the user copied by hand";
    mockCopyExec({});

    const pending = getAskContext();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toEqual({
      text: "text the user copied by hand",
      source: "clipboard",
    });
  });

  it("settles the no-copy case fast — Ask AI's empty selection is the NORMAL path, not a 3s stall", async () => {
    // `waitForClipboardChange`'s own default is 3s. Inheriting it here meant
    // the Ask AI hotkey sat unresponsive for three seconds before its input
    // window opened, every single time nothing was selected — worse than the
    // ~200ms of fixed `delay` the poll replaced. Advancing only 600ms proves
    // the timeout is explicitly bounded: at the 3s default this promise would
    // still be pending here.
    vi.useFakeTimers();
    mockCopyExec({});

    const pending = getAskContext();
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({
      text: "previous clipboard content",
      source: "clipboard",
    });
  });

  it("reports the copy as the source when the copy produced the text", async () => {
    mockCopyExec({ newClipboardValue: "the user's real selection" });

    await expect(getAskContext()).resolves.toEqual({
      text: "the user's real selection",
      source: "selection",
    });
  });

  it("attaches nothing when the copy fails AND the clipboard is empty", async () => {
    // "" still means no context at all: with no copy and nothing to fall back
    // on, the window shows no card rather than an empty one.
    vi.useFakeTimers();
    clipboardState.text = "";
    mockCopyExec({});

    const pending = getAskContext();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toEqual({ text: "", source: "clipboard" });
  });

  it("reads a selection byte-identical to the clipboard as a selection, not a fallback", async () => {
    // Distinguishable only because the pasteboard is emptied first: the value
    // is the same either way, but `source` is what the window shows the user.
    mockCopyExec({ newClipboardValue: "previous clipboard content" });

    await expect(getAskContext()).resolves.toEqual({
      text: "previous clipboard content",
      source: "selection",
    });
  });

  it("maps a keystroke-permission denial to AccessibilityPermissionError, same as getHighlightedText", async () => {
    mockCopyExec({ error: new Error(REAL_DENIAL_MESSAGE) });

    await expect(getAskContext()).rejects.toBeInstanceOf(
      AccessibilityPermissionError,
    );
  });

  it("restores the clipboard after a successful read", async () => {
    mockCopyExec({ newClipboardValue: "the user's real selection" });

    await getAskContext();

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

  it("falls back to the clipboard snapshot when the copy produces nothing, still keeping the parsed activeApp", async () => {
    // Same contract as getHighlightedText (see its doc comment): this stands
    // in for that function at the correction hotkey's ordinary preset call
    // site. Nothing copied is reported as nothing, so the hotkey's own
    // "no text selected" abort fires instead of a transform running on a
    // stale clipboard. The frontmost-app read is independent of the copy and
    // survives either way.
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

  it("returns a selection byte-identical to the previous clipboard, with its activeApp", async () => {
    clipboardState.text = "previous clipboard content";
    mockCopyExec({
      stdout: "Slack\tcom.tinyspeck.slackmacgap",
      newClipboardValue: "previous clipboard content",
    });

    await expect(getHighlightedTextWithActiveApp()).resolves.toEqual({
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
