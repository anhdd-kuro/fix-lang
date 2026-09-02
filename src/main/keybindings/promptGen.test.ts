/**
 * @file promptGen.test.ts
 * @description PromptGen's first test file. Guards two things:
 *
 * 1. The migration off two separate osascript spawns
 *    (`getActiveApp()` + `getHighlightedText()`) onto the single combined
 *    `getHighlightedTextWithActiveApp()` — asserted by spying on the former
 *    two and proving neither is ever called.
 * 2. The same selection-guard block wired into `correction.ts`
 *    (`~/main/keybindings/correction-selection-guards.test.ts`), minus the
 *    latency calls PromptGen has no timer for: a stale clipboard, a denied
 *    frontmost app, or an oversized selection must be stopped before
 *    `generatePrompt` runs.
 *
 * `evaluateSelectionGuards` (`~/features/guards/shared/selectionGuards`) is
 * kept REAL and pure — only its electron-touching neighbours (`guardStore`,
 * `clipboardChangeTracker`, `confirmSelectionGuard`) are mocked, same as the
 * correction test file.
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
  screen: { getCursorScreenPoint: vi.fn().mockReturnValue({ x: 10, y: 20 }) },
  Notification: class {
    show = vi.fn();
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn().mockReturnValue("/tmp"),
    getLocale: vi.fn().mockReturnValue("en-US"),
  },
}));
vi.mock("~/features/correction/store/keybindingStore", () => ({
  keybindingStore: { getKeyBindings: vi.fn() },
}));
vi.mock("~/features/guards/store/guardStore", () => ({
  guardStore: { getSelectionGuardSettings: vi.fn() },
}));
// The secret gate itself (`runSecretGate`, `scanForSecrets`, `maskSecrets`)
// stays REAL for the same reason `evaluateSelectionGuards` does — a mocked
// gate would let a call site that re-derived the per-site policy pass.
vi.mock("~/features/secretGuard/store/secretGuardStore", () => ({
  secretGuardStore: { getSecretGuardSettings: vi.fn() },
}));
vi.mock("~/main/notifications/secretGuardDialog", () => ({
  confirmSecretSend: vi.fn(),
}));
vi.mock("../clipboard/clipboardChangeTracker", () => ({ clipboardAge: vi.fn() }));
vi.mock("../notifications/confirmSelectionGuard", () => ({
  confirmSelectionGuard: vi.fn(),
}));
// Both former call sites of the two-spawn pair this migration replaces are
// spied on directly (rather than merely absent from the mock) so criterion 1
// can assert they are never invoked, not just that nothing crashes.
vi.mock("../../utils", () => ({
  getHighlightedTextWithActiveApp: vi.fn(),
  getHighlightedText: vi.fn(),
}));
vi.mock("~/main/accessibility/activeApp", () => ({
  getActiveApp: vi.fn(),
}));
vi.mock("../ai.request", () => ({ generatePrompt: vi.fn() }));
vi.mock("~/features/history/main/history", () => ({ syncHistory: vi.fn() }));
vi.mock("../logging/logService", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../webViewWindows", () => ({
  hideOverlaySpinner: vi.fn(),
  showOverlaySpinner: vi.fn(),
}));
vi.mock("../webViewWindows/promptGenWindow", () => ({
  showPromptGenWindow: vi.fn(),
}));
// `withHotkeyThrottle` stays REAL, same reason as the correction test file.
vi.mock("./utils", async (importOriginal) => {
  const real = await importOriginal<typeof KeybindingUtils>();
  return { ...real, checkShortcut: vi.fn(), handleError: vi.fn() };
});
// `notifications/error` reaches `overlay.html?asset`, which vite cannot parse
// as JS under vitest. Stub that leaf so `LocalizedError` stays real.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { guardStore } from "~/features/guards/store/guardStore";
import { syncHistory } from "~/features/history/main/history";
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";
import { getActiveApp } from "~/main/accessibility/activeApp";
import { confirmSecretSend } from "~/main/notifications/secretGuardDialog";
import { getHighlightedText, getHighlightedTextWithActiveApp } from "../../utils";
import { generatePrompt } from "../ai.request";
import { registerPromptGenShortcut } from "./promptGen";
import { handleError, resetHotkeyThrottleForTests } from "./utils";
import * as clipboardChangeTracker from "../clipboard/clipboardChangeTracker";
import { logger } from "../logging/logService";
import { confirmSelectionGuard } from "../notifications/confirmSelectionGuard";
import { hideOverlaySpinner, showOverlaySpinner } from "../webViewWindows";
import { showPromptGenWindow } from "../webViewWindows/promptGenWindow";
import type * as KeybindingUtils from "./utils";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";

const PROMPT_GEN_HOTKEY = "Control+Shift+G";

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

/** Registers the PromptGen shortcut and returns its hotkey handler. */
const registerPromptGenHandler = (): (() => Promise<void>) => {
  (keybindingStore.getKeyBindings as Mock).mockReturnValue({ promptGen: PROMPT_GEN_HOTKEY });

  registerPromptGenShortcut({} as BrowserWindow);

  const call = (globalShortcut.register as Mock).mock.calls.find(
    ([shortcut]) => shortcut === PROMPT_GEN_HOTKEY,
  );
  if (!call) {
    throw new Error("promptGen hotkey never registered");
  }
  return call[1] as () => Promise<void>;
};

/**
 * Configures `getHighlightedTextWithActiveApp` to invoke its
 * `onFrontmostReadAndKeystrokeSent` callback before resolving, mirroring the
 * real implementation — that callback is what shows the overlay spinner, so
 * a plain `mockResolvedValue` would silently skip it and desync the spinner
 * assertions below from the real handler's behaviour.
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

/** A credential shaped exactly like the `openai-key` rule's pattern. */
const OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwx";
const SELECTION_WITH_SECRET = `write me a prompt about ${OPENAI_KEY} please`;

/** The salt is random in production, so the placeholder is matched by shape. */
const PLACEHOLDER_PATTERN = /\[\[FIXLANG_SECRET_[0-9A-F]{6}_\d{2}\]\]/;

const setSecretGuardMode = (mode: "off" | "confirm" | "mask"): void => {
  (secretGuardStore.getSecretGuardSettings as Mock).mockReturnValue({
    mode,
    highEntropyRule: false,
  });
};

/** Echoes back what the request was handed, so nothing can be asserted about a round trip that did not happen. */
const mockPromptEcho = (): void => {
  (generatePrompt as Mock).mockImplementation(async ({ text }: { text: string }) => ({
    prompts: [`Prompt about: ${text}`],
    promptTokens: 10,
    completionTokens: 5,
    model: "openai/gpt-4.1-mini",
    provider: "openai",
    resolvedModel: "openai/gpt-4.1-mini",
  }));
};

const historyEntry = () =>
  (syncHistory as Mock).mock.calls[0]?.[0]?.entry as
    | { original: string; corrected: string }
    | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  resetHotkeyThrottleForTests();
  (globalShortcut.register as Mock).mockReturnValue(true);
  (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(defaultGuardSettings());
  (clipboardChangeTracker.clipboardAge as Mock).mockReturnValue(null);
  setSecretGuardMode("confirm");
  (confirmSecretSend as Mock).mockResolvedValue(true);
  (generatePrompt as Mock).mockResolvedValue({
    prompts: ["Prompt A", "Prompt B"],
    promptTokens: 10,
    completionTokens: 5,
    model: "openai/gpt-4.1-mini",
    provider: "openai",
    resolvedModel: "openai/gpt-4.1-mini",
  });
});

describe("promptGen selection read migration — one combined spawn", () => {
  it("never calls the old two-spawn pair (getActiveApp, getHighlightedText)", async () => {
    mockSelection({ text: "some selected text", activeApp: null, changed: true });

    const handler = registerPromptGenHandler();
    await handler();

    expect(getHighlightedTextWithActiveApp).toHaveBeenCalledTimes(1);
    expect(getActiveApp).not.toHaveBeenCalled();
    expect(getHighlightedText).not.toHaveBeenCalled();
  });
});

describe("promptGen selection guards — allow", () => {
  it("runs generatePrompt, shows the PromptGen window, and writes history", async () => {
    mockSelection({ text: "some selected text", activeApp: null, changed: true });

    const handler = registerPromptGenHandler();
    await handler();

    expect(generatePrompt).toHaveBeenCalledTimes(1);
    expect(generatePrompt).toHaveBeenCalledWith({
      text: "some selected text",
      activeAppName: undefined,
    });
    expect(showPromptGenWindow).toHaveBeenCalledTimes(1);
    expect(syncHistory).toHaveBeenCalledTimes(1);
    expect(handleError).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1); // only the final success hide
  });
});

describe("promptGen selection guards — confirm: stale-clipboard", () => {
  it("asks before generatePrompt, and dispatches nothing when declined", async () => {
    mockSelection({ text: "a password copied 40 minutes ago", activeApp: null, changed: false });
    (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
      defaultGuardSettings({ clipboardMaxAgeSeconds: 5 }),
    );
    (clipboardChangeTracker.clipboardAge as Mock).mockReturnValue({ ms: 600_000, origin: "change" });
    (confirmSelectionGuard as Mock).mockResolvedValue(false);

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSelectionGuard).toHaveBeenCalledWith({
      kind: "confirm",
      reason: "stale-clipboard",
      ageMs: 600_000,
      limitMs: 5_000,
    });
    expect(generatePrompt).not.toHaveBeenCalled();
    expect(showPromptGenWindow).not.toHaveBeenCalled();
    expect(syncHistory).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(showOverlaySpinner).toHaveBeenCalledTimes(1); // only the initial combined-read callback

    expect(logger.info).toHaveBeenCalledWith(
      "promptGen.hotkey",
      "PromptGen declined at a selection-guard confirm",
      {
        guardEvent: "declined",
        guardReason: "stale-clipboard",
        selectionAgeMs: 600_000,
        ageLimitMs: 5_000,
      },
    );

    // Cancel is a decision, not an error.
    expect(handleError).not.toHaveBeenCalled();
  });

  it("asks about a baseline-origin age even when the number is well under the limit", async () => {
    mockSelection({ text: "a password copied before launch", activeApp: null, changed: false });
    (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
      defaultGuardSettings({ clipboardMaxAgeSeconds: 5 }),
    );
    (clipboardChangeTracker.clipboardAge as Mock).mockReturnValue({ ms: 12, origin: "baseline" });
    (confirmSelectionGuard as Mock).mockResolvedValue(false);

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSelectionGuard).toHaveBeenCalledWith({
      kind: "confirm",
      reason: "unknown-clipboard-age",
      ageMs: 12,
      limitMs: 5_000,
    });
    expect(generatePrompt).not.toHaveBeenCalled();
  });
});

describe("promptGen selection guards — block: denied-app", () => {
  it("blocks before generatePrompt, naming the app", async () => {
    mockSelection({
      text: "my master password is hunter2",
      activeApp: { name: "1Password", bundleId: "com.1password.1password" },
      changed: true,
    });

    const handler = registerPromptGenHandler();
    await handler();

    expect(generatePrompt).not.toHaveBeenCalled();
    expect(showPromptGenWindow).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);

    expect(logger.warn).toHaveBeenCalledWith(
      "promptGen.hotkey",
      "PromptGen blocked by a selection guard",
      {
        guardEvent: "blocked",
        guardReason: "denied-app",
        deniedBundleId: "com.1password.1password",
      },
    );

    expect(handleError).toHaveBeenCalledTimes(1);
    const [reportedError] = (handleError as Mock).mock.calls[0];
    expect(reportedError).toMatchObject({
      name: "LocalizedError",
      messageKey: "notifications.error.appNotAllowed.body",
      messageParams: { app: "1Password" },
    });
    expect(reportedError.messageKey).not.toBe("notifications.error.noTextSelected.body");
  });
});

describe("promptGen selection guards — confirm: Cancel", () => {
  it("dispatches nothing and raises no error notification", async () => {
    const bigText = "x".repeat(30_000);
    mockSelection({ text: bigText, activeApp: null, changed: true });
    (confirmSelectionGuard as Mock).mockResolvedValue(false);

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSelectionGuard).toHaveBeenCalledWith({
      kind: "confirm",
      reason: "large-selection",
      chars: 30_000,
      limit: 20_000,
    });
    expect(generatePrompt).not.toHaveBeenCalled();
    expect(showPromptGenWindow).not.toHaveBeenCalled();
    // Cancel is a decision, not an error: no error notification at all.
    expect(handleError).not.toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledWith(
      "promptGen.hotkey",
      "PromptGen declined at a selection-guard confirm",
      {
        guardEvent: "declined",
        guardReason: "large-selection",
        textLength: 30_000,
        charLimit: 20_000,
      },
    );

    // Spinner hidden once for the confirm dialog and never re-shown.
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(showOverlaySpinner).toHaveBeenCalledTimes(1);
  });
});

describe("promptGen selection guards — confirm: Send", () => {
  it("re-shows the spinner and proceeds through generatePrompt", async () => {
    const bigText = "x".repeat(30_000);
    mockSelection({ text: bigText, activeApp: null, changed: true });
    (confirmSelectionGuard as Mock).mockResolvedValue(true);

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSelectionGuard).toHaveBeenCalledWith({
      kind: "confirm",
      reason: "large-selection",
      chars: 30_000,
      limit: 20_000,
    });
    expect(generatePrompt).toHaveBeenCalledTimes(1);
    expect(generatePrompt).toHaveBeenCalledWith({ text: bigText, activeAppName: undefined });
    expect(showPromptGenWindow).toHaveBeenCalledTimes(1);
    expect(handleError).not.toHaveBeenCalled();

    // Hidden before the dialog, shown again after "Send anyway", hidden once
    // more on success.
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(2);
    expect(showOverlaySpinner).toHaveBeenCalledTimes(2);
  });
});

describe("promptGen selection guards — precedence", () => {
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
    (clipboardChangeTracker.clipboardAge as Mock).mockReturnValue({ ms: 600_000, origin: "change" });

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSelectionGuard).not.toHaveBeenCalled();
    expect(generatePrompt).not.toHaveBeenCalled();

    expect(logger.warn).toHaveBeenCalledWith(
      "promptGen.hotkey",
      "PromptGen blocked by a selection guard",
      expect.objectContaining({ guardReason: "denied-app" }),
    );
  });
});

describe("promptGen secret guard — off", () => {
  it("sends the raw selection and never opens the dialog", async () => {
    setSecretGuardMode("off");
    mockSelection({ text: SELECTION_WITH_SECRET, activeApp: null, changed: true });

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSecretSend).not.toHaveBeenCalled();
    expect(generatePrompt).toHaveBeenCalledWith({
      text: SELECTION_WITH_SECRET,
      activeAppName: undefined,
    });
  });
});

describe("promptGen secret guard — confirm, declined", () => {
  it("sends nothing, opens no window, writes no history, and raises no error toast", async () => {
    mockSelection({ text: SELECTION_WITH_SECRET, activeApp: null, changed: true });
    (confirmSecretSend as Mock).mockResolvedValue(false);

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSecretSend).toHaveBeenCalledTimes(1);
    expect(generatePrompt).not.toHaveBeenCalled();
    expect(showPromptGenWindow).not.toHaveBeenCalled();
    expect(syncHistory).not.toHaveBeenCalled();
    // Cancel is a decision, not an error — same rule as the size confirm.
    expect(handleError).not.toHaveBeenCalled();
  });

  it("hides the spinner for exactly the dialog's lifetime", async () => {
    mockSelection({ text: SELECTION_WITH_SECRET, activeApp: null, changed: true });
    let spinnerDuringDialog: { shown: number; hidden: number } | null = null;
    (confirmSecretSend as Mock).mockImplementation(async () => {
      spinnerDuringDialog = {
        shown: (showOverlaySpinner as Mock).mock.calls.length,
        hidden: (hideOverlaySpinner as Mock).mock.calls.length,
      };
      return false;
    });

    const handler = registerPromptGenHandler();
    await handler();

    // Down WHILE the modal is up — not bracketing the whole gate, which would
    // blink on every press in confirm mode where nothing is detected.
    expect(spinnerDuringDialog).toEqual({ shown: 1, hidden: 1 });
  });
});

describe("promptGen secret guard — confirm, Send anyway", () => {
  it("sends the RAW selection and re-shows the spinner", async () => {
    mockSelection({ text: SELECTION_WITH_SECRET, activeApp: null, changed: true });

    const handler = registerPromptGenHandler();
    await handler();

    expect(generatePrompt).toHaveBeenCalledWith({
      text: SELECTION_WITH_SECRET,
      activeAppName: undefined,
    });
    expect(showOverlaySpinner).toHaveBeenCalledTimes(2);
    expect(historyEntry()?.original).toBe(SELECTION_WITH_SECRET);
  });
});

describe("promptGen secret guard — mask degrades to mask-no-restore", () => {
  it("sends masked text, opens no dialog, and NEVER restores into the generated prompt", async () => {
    setSecretGuardMode("mask");
    mockSelection({ text: SELECTION_WITH_SECRET, activeApp: null, changed: true });
    mockPromptEcho();

    const handler = registerPromptGenHandler();
    await handler();

    expect(confirmSecretSend).not.toHaveBeenCalled();

    const sent = (generatePrompt as Mock).mock.calls[0][0].text as string;
    expect(sent).not.toContain(OPENAI_KEY);
    expect(sent).toMatch(PLACEHOLDER_PATTERN);

    // A prompt containing placeholders IS the correct artifact here: promptGen
    // produces a generated prompt, not a rewrite, and it never pastes.
    const shown = (showPromptGenWindow as Mock).mock.calls[0][0] as { prompts: string[] };
    expect(shown.prompts[0]).toMatch(PLACEHOLDER_PATTERN);
    expect(shown.prompts[0]).not.toContain(OPENAI_KEY);
  });

  it("stores masked text on both sides of history", async () => {
    setSecretGuardMode("mask");
    mockSelection({ text: SELECTION_WITH_SECRET, activeApp: null, changed: true });
    mockPromptEcho();

    const handler = registerPromptGenHandler();
    await handler();

    const entry = historyEntry();
    expect(entry?.original).not.toContain(OPENAI_KEY);
    expect(entry?.original).toMatch(PLACEHOLDER_PATTERN);
    expect(entry?.corrected).not.toContain(OPENAI_KEY);
  });
});

describe("promptGen selection guards — no selection", () => {
  it("aborts with the generic no-text-selected error, distinct from the guard errors", async () => {
    mockSelection({ text: "", activeApp: null, changed: false });

    const handler = registerPromptGenHandler();
    await handler();

    expect(generatePrompt).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);

    expect(handleError).toHaveBeenCalledTimes(1);
    const [reportedError] = (handleError as Mock).mock.calls[0];
    expect(reportedError).toMatchObject({
      name: "LocalizedError",
      messageKey: "notifications.error.noTextSelected.body",
    });
  });
});
