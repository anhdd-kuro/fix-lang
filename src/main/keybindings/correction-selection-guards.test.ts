/**
 * @file correction-selection-guards.test.ts
 * @description Guard for the selection-guard block wired into
 * `registerCorrectionShortcut`'s ordinary (non-Ask) preset branch: a stale
 * clipboard, a denied frontmost app, or an oversized selection must be
 * stopped before `fixGrammar`/`pasteText` run, with exactly one latency
 * `finish` per press either way.
 *
 * `evaluateSelectionGuards` (`~/features/guards/shared/selectionGuards`) and
 * `startLatencyTimer` (`../logging/latencyTimer`) are kept REAL and pure —
 * only their electron-touching neighbours (`guardStore`,
 * `clipboardChangeTracker`, `confirmLargeSelection`) are mocked, same as
 * `correction-preset-hotkeys.test.ts` keeps `normalizeCorrectionSettings`
 * real while mocking `apiStore`'s electron-store backing.
 */
import { globalShortcut } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("electron-store", () => {
  class MockStore {
    get = vi.fn().mockReturnValue(undefined);
    set = vi.fn();
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});
vi.mock("electron", () => ({
  globalShortcut: { register: vi.fn().mockReturnValue(true) },
  Notification: class {
    show = vi.fn();
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn().mockReturnValue("/tmp"),
    getLocale: vi.fn().mockReturnValue("en-US"),
  },
}));
vi.mock("~/features/providers/store/apiStore", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.importActual returns unknown module shape
  const real = await importOriginal<any>();
  return {
    ...real,
    getProfileSetting: vi.fn(),
    updateProfileSetting: vi.fn(),
    getDefaultModelId: vi.fn().mockReturnValue(""),
    apiStore: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
  };
});
vi.mock("~/features/correction/store/keybindingStore", () => ({
  keybindingStore: {
    getKeyBindings: vi.fn(() => ({
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    })),
  },
}));
vi.mock("~/features/correction/store/outputModeStore", () => ({
  // "paste" (not "popup") so the delivery assertions below exercise the same
  // `pasteText` call site the card's criteria name explicitly.
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("paste") },
}));
vi.mock("~/features/guards/store/guardStore", () => ({
  guardStore: { getSelectionGuardSettings: vi.fn() },
}));
vi.mock("../clipboard/clipboardChangeTracker", () => ({ ageMs: vi.fn() }));
vi.mock("../notifications/confirmLargeSelection", () => ({
  confirmLargeSelection: vi.fn(),
}));
vi.mock("../../utils", () => ({
  getHighlightedTextWithActiveApp: vi.fn(),
  getHighlightedTextForOptionalContext: vi.fn().mockResolvedValue(""),
  pasteText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ai.request", () => ({ fixGrammar: vi.fn() }));
vi.mock("~/features/history/main/history", () => ({ syncHistory: vi.fn() }));
vi.mock("../logging/logService", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../webViewWindows", () => ({
  hideOverlaySpinner: vi.fn(),
  showOverlaySpinner: vi.fn(),
}));
vi.mock("../webViewWindows/correctionResultWindow", () => ({
  showCorrectionResultWindow: vi.fn(),
}));
vi.mock("../webViewWindows/askInputWindow", () => ({
  showAskInputWindow: vi.fn(),
}));
vi.mock("./askFlow", () => ({ runAskFlow: vi.fn() }));
// `withHotkeyThrottle` stays REAL, same reason as `correction-preset-hotkeys.test.ts`.
vi.mock("./utils", async (importOriginal) => {
  const real = await importOriginal<typeof KeybindingUtils>();
  return { ...real, checkShortcut: vi.fn(), handleError: vi.fn() };
});
// `notifications/error` reaches `overlay.html?asset`, which vite cannot parse
// as JS under vitest. Stub that leaf so `LocalizedError` stays real.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
import { guardStore } from "~/features/guards/store/guardStore";
import { redactLogContext } from "~/features/logs/shared/logging";
import { getProfileSetting, normalizeCorrectionSettings } from "~/features/providers/store/apiStore";
import { registerCorrectionShortcut } from "./correction";
import { handleError, resetHotkeyThrottleForTests } from "./utils";
import { getHighlightedTextWithActiveApp, pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import * as clipboardChangeTracker from "../clipboard/clipboardChangeTracker";
import { logger } from "../logging/logService";
import { confirmLargeSelection } from "../notifications/confirmLargeSelection";
import { hideOverlaySpinner, showOverlaySpinner } from "../webViewWindows";
import type * as KeybindingUtils from "./utils";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";

const CORRECTION_HOTKEY = "Control+Shift+F";

const storedBuiltIn = (id: string, name: string, hotkey: string) => ({
  id,
  name,
  hotkey,
  systemPrompt: `${name} prompt.`,
  model: "openai/gpt-4.1-mini",
  isBuiltIn: true,
});

const SINGLE_BUILT_IN_PROFILE = {
  presets: [storedBuiltIn("correction", "Correction", CORRECTION_HOTKEY)],
  selectedPresetId: "correction",
};

const fakeMainWindow = () =>
  ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow;

const defaultGuardSettings = (
  overrides: Partial<{
    clipboardMaxAgeSeconds: number;
    maxSelectionChars: number;
    deniedBundleIds: string[];
  }> = {},
) => ({
  clipboardMaxAgeSeconds: 5,
  maxSelectionChars: 20_000,
  deniedBundleIds: ["com.1password.1password"],
  ...overrides,
});

/** Registers the single correction preset and returns its hotkey handler. */
const registerCorrectionHandler = (): (() => Promise<void>) => {
  (getProfileSetting as Mock).mockImplementation((key: string) =>
    key === "models" ? [] : normalizeCorrectionSettings(SINGLE_BUILT_IN_PROFILE),
  );

  registerCorrectionShortcut(fakeMainWindow());

  const call = (globalShortcut.register as Mock).mock.calls.find(
    ([shortcut]) => shortcut === CORRECTION_HOTKEY,
  );
  if (!call) {
    throw new Error("correction hotkey never registered");
  }
  return call[1] as () => Promise<void>;
};

/** Every `logger.info` call recorded against the latency scope, in order. */
const latencyFinishCalls = () =>
  (logger.info as Mock).mock.calls.filter(([scope]) => scope === "correction.latency");

/**
 * Configures `getHighlightedTextWithActiveApp` to invoke its
 * `onFrontmostReadAndKeystrokeSent` callback before resolving, mirroring the
 * real implementation — that callback is what shows the overlay spinner, so
 * a plain `mockResolvedValue` would silently skip it and desync every
 * spinner-count assertion below from the real handler's behaviour.
 */
const mockSelection = (result: {
  text: string;
  activeApp: { name: string; bundleId: string | null } | null;
  changed: boolean;
}): void => {
  (getHighlightedTextWithActiveApp as Mock).mockImplementation(
    async (onFrontmostReadAndKeystrokeSent?: () => void) => {
      onFrontmostReadAndKeystrokeSent?.();
      return result;
    },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  resetHotkeyThrottleForTests();
  (globalShortcut.register as Mock).mockReturnValue(true);
  (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(defaultGuardSettings());
  (clipboardChangeTracker.ageMs as Mock).mockReturnValue(null);
  (fixGrammar as Mock).mockResolvedValue({
    correctedText: "corrected text",
    promptTokens: 10,
    completionTokens: 5,
    model: "openai/gpt-4.1-mini",
    provider: "openai",
    resolvedModel: "openai/gpt-4.1-mini",
    presetName: "Correction",
  });
});

describe("correction selection guards — allow", () => {
  it("runs fixGrammar and pasteText, with exactly one delivered latency finish", async () => {
    mockSelection({ text: "some selected text", activeApp: null, changed: true });

    const handler = registerCorrectionHandler();
    await handler();

    expect(fixGrammar).toHaveBeenCalledTimes(1);
    expect(pasteText).toHaveBeenCalledTimes(1);
    expect(handleError).not.toHaveBeenCalled();

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "delivered" });
  });
});

describe("correction selection guards — block: stale-clipboard", () => {
  it("blocks before any provider call, with a distinct localized error and one finish", async () => {
    mockSelection({ text: "a password copied 40 minutes ago", activeApp: null, changed: false });
    (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
      defaultGuardSettings({ clipboardMaxAgeSeconds: 5 }),
    );
    (clipboardChangeTracker.ageMs as Mock).mockReturnValue(600_000);

    const handler = registerCorrectionHandler();
    await handler();

    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).toHaveBeenCalled();
    expect(showOverlaySpinner).toHaveBeenCalledTimes(1); // only the initial combined-read callback

    expect(logger.warn).toHaveBeenCalledWith(
      "correction.hotkey",
      "Transform blocked by a selection guard",
      {
        presetId: "correction",
        guardReason: "stale-clipboard",
        selectionAgeMs: 600_000,
        ageLimitMs: 5_000,
      },
    );

    // Feed the ACTUAL object the guard block emitted — not a hand-copied
    // literal — through the REAL redactor. `redactLogContext` blanks any
    // context key merely CONTAINING `clipboard`/`token`/`secret`/`password`/
    // `selected_text`, silently. `clipboardChanged` already shipped that
    // trap once (card 05 renamed it to `pasteboardChanged`); the natural
    // name here would be `clipboardAgeMs`, which this line would catch.
    const [, , staleClipboardContext] = (logger.warn as Mock).mock.calls[0];
    expect(redactLogContext(staleClipboardContext)).toEqual(staleClipboardContext);

    expect(handleError).toHaveBeenCalledTimes(1);
    const [reportedError] = (handleError as Mock).mock.calls[0];
    expect(reportedError).toMatchObject({
      name: "LocalizedError",
      messageKey: "notifications.error.staleClipboard.body",
    });
    // Distinct from the plain "nothing selected" abort — never the generic key.
    expect(reportedError.messageKey).not.toBe("notifications.error.noTextSelected.body");

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "stale-clipboard" });
  });
});

describe("correction selection guards — block: denied-app", () => {
  it("blocks before any provider call, naming the app, with one finish", async () => {
    mockSelection({
      text: "my master password is hunter2",
      activeApp: { name: "1Password", bundleId: "com.1password.1password" },
      changed: true,
    });

    const handler = registerCorrectionHandler();
    await handler();

    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).toHaveBeenCalled();

    expect(logger.warn).toHaveBeenCalledWith(
      "correction.hotkey",
      "Transform blocked by a selection guard",
      {
        presetId: "correction",
        guardReason: "denied-app",
        deniedBundleId: "com.1password.1password",
      },
    );

    // Same real-redactor feed as the stale-clipboard block above, against
    // this branch's own emitted keys (`deniedBundleId`, not `selectionAgeMs`).
    const [, , deniedAppContext] = (logger.warn as Mock).mock.calls[0];
    expect(redactLogContext(deniedAppContext)).toEqual(deniedAppContext);

    expect(handleError).toHaveBeenCalledTimes(1);
    const [reportedError] = (handleError as Mock).mock.calls[0];
    expect(reportedError).toMatchObject({
      name: "LocalizedError",
      messageKey: "notifications.error.appNotAllowed.body",
      messageParams: { app: "1Password" },
    });
    expect(reportedError.messageKey).not.toBe("notifications.error.noTextSelected.body");

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "denied-app" });
  });
});

describe("correction selection guards — confirm: Cancel", () => {
  it("dispatches nothing, raises no error notification, and finishes as declined-size", async () => {
    const bigText = "x".repeat(30_000);
    mockSelection({ text: bigText, activeApp: null, changed: true });
    (confirmLargeSelection as Mock).mockResolvedValue(false);

    const handler = registerCorrectionHandler();
    await handler();

    expect(confirmLargeSelection).toHaveBeenCalledWith(30_000, 20_000);
    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    // Cancel is a decision, not an error: no error notification at all.
    expect(handleError).not.toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledWith(
      "correction.hotkey",
      "Transform declined at the large-selection confirm",
      { presetId: "correction", textLength: 30_000, charLimit: 20_000 },
    );

    // Same real-redactor feed as the block tests above — `textLength` and
    // `charLimit` are this branch's own emitted keys.
    const declinedSizeContext = (logger.info as Mock).mock.calls.find(
      ([, message]) => message === "Transform declined at the large-selection confirm",
    )?.[2];
    expect(redactLogContext(declinedSizeContext)).toEqual(declinedSizeContext);

    // Spinner hidden once for the confirm dialog and never re-shown.
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(showOverlaySpinner).toHaveBeenCalledTimes(1);

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "declined-size" });
  });
});

describe("correction selection guards — confirm: Send", () => {
  it("re-shows the spinner and proceeds through fixGrammar and pasteText, with one delivered finish", async () => {
    const bigText = "x".repeat(30_000);
    mockSelection({ text: bigText, activeApp: null, changed: true });
    (confirmLargeSelection as Mock).mockResolvedValue(true);

    const handler = registerCorrectionHandler();
    await handler();

    expect(confirmLargeSelection).toHaveBeenCalledWith(30_000, 20_000);
    expect(fixGrammar).toHaveBeenCalledTimes(1);
    expect(fixGrammar).toHaveBeenCalledWith(bigText, "correction", expect.anything());
    expect(pasteText).toHaveBeenCalledTimes(1);
    expect(handleError).not.toHaveBeenCalled();

    // Hidden before the dialog, shown again after "Send anyway".
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(2);
    expect(showOverlaySpinner).toHaveBeenCalledTimes(2);

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "delivered" });
  });
});

describe("correction selection guards — log key redaction safety", () => {
  const REDACTED = "[REDACTED]";

  /**
   * The natural-sounding names a future reader would reach for instead of
   * the approved ones — and the reason this guard block must never use them.
   * `clipboardAgeMs` reads better than `selectionAgeMs`, but `redactLogContext`
   * blanks any key merely CONTAINING `clipboard`, silently. This repo has
   * already shipped that exact mistake once: `clipboardChanged` persisted as
   * `"[REDACTED]"` in production until card 05 renamed it to
   * `pasteboardChanged`. Pinning the rejects (not just the approved names
   * above) is what stops a future "simplification" back to the natural name.
   */
  it.each([
    ["clipboardAgeMs", "selectionAgeMs"],
    ["selectedTextLength", "textLength"],
  ] as const)("%s is blanked by the real redactor — ship %s instead", (rejected, approved) => {
    expect(redactLogContext({ [rejected]: 600_000 })[rejected]).toBe(REDACTED);
    expect(redactLogContext({ [approved]: 600_000 })[approved]).not.toBe(REDACTED);
  });
});

describe("correction selection guards — confirm: Send with a slow dialog", () => {
  it("excludes the user's deliberation time from totalMs and reports it as pausedMs", async () => {
    // The entire reason plan.md paused/resumed the timer around the confirm
    // dialog instead of adding a latency phase: a long user decision must not
    // read as a slow provider. The clock is driven by `confirmLargeSelection`
    // itself (mocked) advancing a spied `Date.now`, which `startLatencyTimer`
    // reads directly since `correction.ts` injects no clock of its own.
    const bigText = "x".repeat(30_000);
    mockSelection({ text: bigText, activeApp: null, changed: true });

    const DIALOG_WAIT_MS = 15_000;
    // `withHotkeyThrottle` reads its own `now` default (`Date.now`, spied
    // below) at registration time and compares against a `last` of 0
    // cleared by `resetHotkeyThrottleForTests` — starting the fake clock at
    // 0 would make `at - last` read as inside the throttle window and the
    // press would be silently dropped. Anything past HOTKEY_THROTTLE_MS avoids it.
    let clock = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    (confirmLargeSelection as Mock).mockImplementation(async () => {
      clock += DIALOG_WAIT_MS;
      return true;
    });

    try {
      const handler = registerCorrectionHandler();
      await handler();
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(fixGrammar).toHaveBeenCalledTimes(1);
    expect(pasteText).toHaveBeenCalledTimes(1);

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    const [, , context] = finishes[0];
    expect(context).toMatchObject({ outcome: "delivered" });
    // Every OTHER Date.now() read in this run happens while the clock hasn't
    // moved, so these come out exact rather than merely bounded.
    expect(context.pausedMs).toBe(DIALOG_WAIT_MS);
    expect(context.totalMs).toBe(0);
  });
});

describe("correction selection guards — confirm dialog rejects", () => {
  it("excludes the still-open dialog wait from totalMs when confirmLargeSelection throws, with exactly one finish", async () => {
    // `confirmLargeSelection` REJECTING (not the user clicking Cancel, which
    // resolves `false` and is covered above) skips the `latency.resume()`
    // line that sits right after the `await` in correction.ts, so `finish`
    // in the `catch` block runs while the pause is still open. That is
    // exactly the `openPauseMs` accounting in latencyTimer.ts's `finish` —
    // without it, a 30-second dialog that then throws would report that
    // whole wait as `totalMs` on a `failed` line.
    const bigText = "x".repeat(30_000);
    mockSelection({ text: bigText, activeApp: null, changed: true });

    const DIALOG_WAIT_MS = 30_000;
    // `withHotkeyThrottle` reads its own `now` default (`Date.now`, spied
    // below) at registration time and compares against a `last` of 0
    // cleared by `resetHotkeyThrottleForTests` — starting the fake clock at
    // 0 would make `at - last` read as inside the throttle window and the
    // press would be silently dropped. Anything past HOTKEY_THROTTLE_MS avoids it.
    let clock = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const dialogError = new Error("dialog window destroyed");
    (confirmLargeSelection as Mock).mockImplementation(async () => {
      clock += DIALOG_WAIT_MS;
      throw dialogError;
    });

    try {
      const handler = registerCorrectionHandler();
      await handler();
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledTimes(1);
    expect(handleError).toHaveBeenCalledWith(dialogError);

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    const [, , context] = finishes[0];
    expect(context).toMatchObject({ outcome: "failed" });
    expect(context.pausedMs).toBe(DIALOG_WAIT_MS);
    expect(context.totalMs).toBe(0);
  });
});

describe("correction selection guards — precedence", () => {
  it("blocks as denied-app even when the same selection is also stale and oversized", async () => {
    const bigText = "x".repeat(30_000);
    mockSelection({
      text: bigText,
      activeApp: { name: "1Password", bundleId: "com.1password.1password" },
      changed: false,
    });
    (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
      defaultGuardSettings({ clipboardMaxAgeSeconds: 5, maxSelectionChars: 20_000 }),
    );
    (clipboardChangeTracker.ageMs as Mock).mockReturnValue(600_000);

    const handler = registerCorrectionHandler();
    await handler();

    expect(confirmLargeSelection).not.toHaveBeenCalled();
    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();

    expect(logger.warn).toHaveBeenCalledWith(
      "correction.hotkey",
      "Transform blocked by a selection guard",
      expect.objectContaining({ guardReason: "denied-app" }),
    );

    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "denied-app" });
  });
});
