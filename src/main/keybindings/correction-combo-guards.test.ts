/**
 * @file correction-combo-guards.test.ts
 * @description Guard for the selection guards + secret gate wired into
 * `registerCorrectionShortcut`'s COMBO branch.
 *
 * The combo branch and the ordinary preset branch landed on separate branches
 * and were merged without being connected, so for one release a combo hotkey
 * read a selection and handed it to `runCombo` with none of the four guard
 * rails and no secret gate — and a combo is worse than a single transform
 * here, not better: it sends the same selection to N models in sequence.
 * These tests exist so a future edit cannot quietly reopen that gap.
 *
 * `evaluateSelectionGuards`, `runSecretGate`, `scanForSecrets`, `maskSecrets`
 * and `runCombo` are all kept REAL — only their electron-touching neighbours
 * (`guardStore`, `secretGuardStore`, `clipboardChangeTracker`,
 * `confirmSelectionGuard`, `confirmSecretSend`) are mocked. A mocked gate
 * would let a call site that re-derives the per-site policy pass, which is
 * exactly the failure `SECRET_SEND_SITE_POLICY` exists to prevent.
 */
import { globalShortcut, Notification } from "electron";
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
  // `unregister` matters here: `withComboCancel` always calls it in its
  // `finally`, on both the resolve and reject paths — an unmocked call throws
  // and masks whatever the run actually did.
  globalShortcut: { register: vi.fn().mockReturnValue(true), unregister: vi.fn() },
  Notification: vi.fn().mockImplementation(function () {
    return { show: vi.fn() };
  }),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn().mockReturnValue("/tmp"),
    getLocale: vi.fn().mockReturnValue("en-US"),
    getSystemLocale: vi.fn().mockReturnValue("en-US"),
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
  // "paste" (not "popup") so the delivery assertions exercise the same
  // `pasteText` call site a real combo pastes through.
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("paste") },
}));
vi.mock("~/features/guards/store/guardStore", () => ({
  guardStore: { getSelectionGuardSettings: vi.fn() },
}));
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
vi.mock("../../utils", () => ({
  getHighlightedTextWithActiveApp: vi.fn(),
  getAskContext: vi.fn().mockResolvedValue({ text: "", source: "clipboard" }),
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
  updateComboProgress: vi.fn(),
}));
vi.mock("../webViewWindows/correctionResultWindow", () => ({
  showCorrectionResultWindow: vi.fn(),
}));
vi.mock("../webViewWindows/askInputWindow", () => ({
  showAskInputWindow: vi.fn(),
}));
vi.mock("./askFlow", () => ({
  runAskFlow: vi.fn(),
  buildAppLocaleDirective: vi.fn().mockReturnValue("App locale: en"),
}));
vi.mock("./askEnvironment", () => ({
  resolveAskEnvironment: vi.fn().mockResolvedValue({
    appLocale: "en",
    systemLocale: "en-US",
    keyboardInputSource: "ABC",
    capturedAt: "2026-08-11T09:00:00+09:00",
    timeZone: "Asia/Tokyo",
    recentTransforms: [],
  }),
  buildAskDirectives: vi.fn().mockReturnValue("App locale: en\nSystem language: en-US"),
}));
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
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";
import { confirmSecretSend } from "~/main/notifications/secretGuardDialog";
import { resetActiveComboForTests } from "./comboCancel";
import { resetComboLockForTests } from "./comboLock";
import { COMBO_LOCK_MAX_HOLD_MS, registerCorrectionShortcut } from "./correction";
import { handleError, resetHotkeyThrottleForTests } from "./utils";
import { getHighlightedTextWithActiveApp, pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import * as clipboardChangeTracker from "../clipboard/clipboardChangeTracker";
import { logger } from "../logging/logService";
import { confirmSelectionGuard } from "../notifications/confirmSelectionGuard";
import {
  hideOverlaySpinner,
  showOverlaySpinner,
  updateComboProgress,
} from "../webViewWindows";
import { showCorrectionResultWindow } from "../webViewWindows/correctionResultWindow";
import type * as KeybindingUtils from "./utils";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";
import type { LogContext } from "~/features/logs/shared/logging";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";

const COMBO_HOTKEY = "Control+Alt+K";

/** A credential shaped exactly like the `openai-key` rule's pattern. */
const OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwx";
const SELECTION_WITH_SECRET = `please polish this my key is ${OPENAI_KEY} thanks`;

/** The salt is random in production, so a placeholder is matched by shape. */
const PLACEHOLDER_PATTERN = /\[\[FIXLANG_SECRET_[0-9A-F]{6}_\d{2}\]\]/;

const storedBuiltIn = (id: string, name: string, hotkey: string) => ({
  id,
  name,
  hotkey,
  systemPrompt: `${name} prompt.`,
  model: "openai/gpt-4.1-mini",
  isBuiltIn: true,
});

/** A valid 2-step combo referencing two real built-in presets. */
const TWO_STEP_COMBO_PROFILE = {
  presets: [
    storedBuiltIn("correction", "Correction", "Control+Shift+F"),
    storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
  ],
  selectedPresetId: "correction",
  combos: [
    {
      id: "combo-1",
      name: "Polish and Summarize",
      hotkey: COMBO_HOTKEY,
      steps: [
        { id: "s1", presetId: "correction" },
        { id: "s2", presetId: "summarize" },
      ],
      schemaVersion: 1,
    },
  ],
};

const mainWindowSend = vi.fn();

const fakeMainWindow = () =>
  ({
    isDestroyed: () => false,
    webContents: { send: mainWindowSend },
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

/** Registers the profile above and returns the combo hotkey's handler. */
const registerComboHandler = (): (() => Promise<void>) => {
  (getProfileSetting as Mock).mockImplementation((key: string) =>
    key === "models" ? [] : normalizeCorrectionSettings(TWO_STEP_COMBO_PROFILE),
  );

  registerCorrectionShortcut(fakeMainWindow());

  const call = (globalShortcut.register as Mock).mock.calls.find(
    ([shortcut]) => shortcut === COMBO_HOTKEY,
  );
  if (!call) {
    throw new Error("combo hotkey never registered");
  }
  return call[1] as () => Promise<void>;
};

/**
 * Mirrors the real read by firing `onFrontmostReadAndKeystrokeSent` before
 * resolving — that callback is what shows the overlay spinner, so a plain
 * `mockResolvedValue` would desync every spinner assertion below.
 */
const mockSelection = (result: {
  text: string;
  activeApp?: { name: string; bundleId: string | null } | null;
  changed?: boolean;
}): void => {
  (getHighlightedTextWithActiveApp as Mock).mockImplementation(
    async (onFrontmostReadAndKeystrokeSent?: () => void) => {
      onFrontmostReadAndKeystrokeSent?.();
      return {
        text: result.text,
        activeApp: result.activeApp ?? null,
        changed: result.changed ?? true,
      };
    },
  );
};

const setSecretGuardMode = (settings: Partial<SecretGuardSettings>): void => {
  (secretGuardStore.getSecretGuardSettings as Mock).mockReturnValue({
    mode: "confirm",
    highEntropyRule: false,
    ...settings,
  });
};

const latencyFinishCalls = () =>
  (logger.info as Mock).mock.calls.filter(([scope]) => scope === "correction.latency");

const latencyOutcome = () => {
  const finishes = latencyFinishCalls();
  expect(finishes).toHaveLength(1);
  return finishes[0][2] as { outcome: string };
};

/** The i18n key the one `handleError` call carried. */
const errorMessageKey = (): string | undefined => {
  const call = (handleError as Mock).mock.calls[0];
  return (call?.[0] as { messageKey?: string } | undefined)?.messageKey;
};

/** What step 1 was handed — i.e. what `runCombo` was given as `input`. */
const sentToFirstStep = (): string => (fixGrammar as Mock).mock.calls[0][0] as string;

/** True when `runCombo` never ran a step and never painted its progress ring. */
const expectComboNeverRan = (): void => {
  expect(fixGrammar).not.toHaveBeenCalled();
  expect(updateComboProgress).not.toHaveBeenCalled();
  expect(pasteText).not.toHaveBeenCalled();
  expect(showCorrectionResultWindow).not.toHaveBeenCalled();
  expect(mainWindowSend).not.toHaveBeenCalledWith("start-loading");
};

beforeEach(() => {
  vi.clearAllMocks();
  resetHotkeyThrottleForTests();
  resetComboLockForTests();
  resetActiveComboForTests();
  (globalShortcut.register as Mock).mockReturnValue(true);
  (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(defaultGuardSettings());
  (clipboardChangeTracker.clipboardAge as Mock).mockReturnValue(null);
  setSecretGuardMode({ mode: "off" });
  mockSelection({ text: "some selected text" });
  // Each step returns text derived from what it was handed, so no assertion
  // can describe a chain that did not actually happen.
  (fixGrammar as Mock).mockImplementation(async (text: string) => ({
    correctedText: `${text} (transformed)`,
    promptTokens: 10,
    completionTokens: 5,
    model: "openai/gpt-4.1-mini",
    provider: "openai",
    resolvedModel: "openai/gpt-4.1-mini",
    presetName: "whichever",
  }));
});

describe("combo selection guards — allow", () => {
  it("runs every step and pastes once, with exactly one delivered latency finish", async () => {
    const handler = registerComboHandler();
    await handler();

    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(sentToFirstStep()).toBe("some selected text");
    expect(pasteText).toHaveBeenCalledTimes(1);
    expect(handleError).not.toHaveBeenCalled();
    expect(latencyOutcome()).toMatchObject({ outcome: "delivered" });
  });
});

describe("combo selection guards — confirm: stale-clipboard", () => {
  it("asks before any provider call, and runs nothing when declined", async () => {
    mockSelection({ text: "a password copied 40 minutes ago", changed: false });
    (clipboardChangeTracker.clipboardAge as Mock).mockReturnValue({ ms: 2_400_000, origin: "change" });
    (confirmSelectionGuard as Mock).mockResolvedValue(false);

    const handler = registerComboHandler();
    await handler();

    expect(confirmSelectionGuard).toHaveBeenCalledWith({
      kind: "confirm",
      reason: "stale-clipboard",
      ageMs: 2_400_000,
      limitMs: 5_000,
    });
    expectComboNeverRan();
    expect(latencyOutcome()).toMatchObject({ outcome: "declined-stale" });
    expect(hideOverlaySpinner).toHaveBeenCalled();
    // Cancel is a decision, not an error.
    expect(handleError).not.toHaveBeenCalled();

    const info = (logger.info as Mock).mock.calls.find(
      ([, message]) => message === "Combo declined at a selection-guard confirm",
    );
    expect(info?.[2]).toMatchObject({
      comboId: "combo-1",
      guardReason: "stale-clipboard",
      selectionAgeMs: 2_400_000,
      ageLimitMs: 5_000,
    });
  });
});

describe("combo selection guards — block: denied-app", () => {
  it("blocks before any provider call, with the deny-list error and one finish", async () => {
    mockSelection({
      text: "a vault entry",
      activeApp: { name: "1Password", bundleId: "com.1password.1password" },
    });

    const handler = registerComboHandler();
    await handler();

    expectComboNeverRan();
    expect(latencyOutcome()).toMatchObject({ outcome: "denied-app" });
    expect(handleError).toHaveBeenCalledTimes(1);
    expect(errorMessageKey()).toBe("notifications.error.appNotAllowed.body");

    const warn = (logger.warn as Mock).mock.calls.find(
      ([, message]) => message === "Combo blocked by a selection guard",
    );
    expect(warn?.[2]).toMatchObject({
      comboId: "combo-1",
      guardReason: "denied-app",
      deniedBundleId: "com.1password.1password",
    });
  });
});

describe("combo selection guards — confirm: Cancel", () => {
  it("sends nothing and finishes as declined-size, with NO error notification", async () => {
    mockSelection({ text: "x".repeat(40) });
    (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
      defaultGuardSettings({ maxSelectionChars: 10 }),
    );
    (confirmSelectionGuard as Mock).mockResolvedValue(false);

    const handler = registerComboHandler();
    await handler();

    expect(confirmSelectionGuard).toHaveBeenCalledWith({
      kind: "confirm",
      reason: "large-selection",
      chars: 40,
      limit: 10,
    });
    expectComboNeverRan();
    expect(latencyOutcome()).toMatchObject({ outcome: "declined-size" });
    // Cancel is a choice, not an error: no toast, no notification.
    expect(handleError).not.toHaveBeenCalled();
    expect(Notification).not.toHaveBeenCalled();
  });
});

describe("combo selection guards — confirm: Send", () => {
  it("re-shows the spinner and runs the whole chain, with one delivered finish", async () => {
    mockSelection({ text: "x".repeat(40) });
    (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
      defaultGuardSettings({ maxSelectionChars: 10 }),
    );
    (confirmSelectionGuard as Mock).mockResolvedValue(true);

    const handler = registerComboHandler();
    await handler();

    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(pasteText).toHaveBeenCalledTimes(1);
    // Once from the selection read's callback, once after the dialog closed.
    expect(showOverlaySpinner).toHaveBeenCalledTimes(2);
    expect(latencyOutcome()).toMatchObject({ outcome: "delivered" });
  });
});

describe("combo selection guards — an empty selection keeps its own message", () => {
  it("reports no-selection without consulting the guards, even from a denied app", async () => {
    mockSelection({
      text: "   ",
      activeApp: { name: "1Password", bundleId: "com.1password.1password" },
    });

    const handler = registerComboHandler();
    await handler();

    expectComboNeverRan();
    expect(guardStore.getSelectionGuardSettings).not.toHaveBeenCalled();
    expect(latencyOutcome()).toMatchObject({ outcome: "no-selection" });
    expect(errorMessageKey()).toBe("notifications.error.noTextSelected.body");
  });
});

describe("combo secret gate — decline", () => {
  it("sends nothing and finishes as secret-declined, with NO error notification", async () => {
    mockSelection({ text: SELECTION_WITH_SECRET });
    setSecretGuardMode({ mode: "confirm" });
    (confirmSecretSend as Mock).mockResolvedValue(false);

    const handler = registerComboHandler();
    await handler();

    expect(confirmSecretSend).toHaveBeenCalledTimes(1);
    expectComboNeverRan();
    expect(latencyOutcome()).toMatchObject({ outcome: "secret-declined" });
    expect(handleError).not.toHaveBeenCalled();
    expect(Notification).not.toHaveBeenCalled();
  });
});

describe("combo secret gate — send anyway", () => {
  it("runs the chain on the confirmed text and pastes once", async () => {
    mockSelection({ text: SELECTION_WITH_SECRET });
    setSecretGuardMode({ mode: "confirm" });
    (confirmSecretSend as Mock).mockResolvedValue(true);

    const handler = registerComboHandler();
    await handler();

    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(sentToFirstStep()).toBe(SELECTION_WITH_SECRET);
    expect(pasteText).toHaveBeenCalledTimes(1);
    expect(latencyOutcome()).toMatchObject({ outcome: "delivered" });
  });
});

describe("combo secret gate — a clean selection never opens the dialog", () => {
  it("runs the chain with no dialog in confirm mode", async () => {
    mockSelection({ text: "nothing sensitive here at all" });
    setSecretGuardMode({ mode: "confirm" });

    const handler = registerComboHandler();
    await handler();

    expect(confirmSecretSend).not.toHaveBeenCalled();
    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(latencyOutcome()).toMatchObject({ outcome: "delivered" });
  });
});

/**
 * The mask-mode decision for this site, asserted through the REAL gate rather
 * than by reading the policy table: a combo folds N presets whose final
 * artifact may be a summary or a generated prompt rather than a rewrite of the
 * selection, and `runCombo` delivers that artifact itself. Masking there would
 * either paste placeholders over the user's selection or restore a live
 * credential into a derived artifact — so masking degrades to a confirm, the
 * same way it does for Ask.
 */
describe("combo secret gate — mask mode degrades to a confirm at this site", () => {
  it("opens the dialog and, on Send, hands step 1 the raw text with no placeholder", async () => {
    mockSelection({ text: SELECTION_WITH_SECRET });
    setSecretGuardMode({ mode: "mask" });
    (confirmSecretSend as Mock).mockResolvedValue(true);

    const handler = registerComboHandler();
    await handler();

    expect(confirmSecretSend).toHaveBeenCalledTimes(1);
    expect(sentToFirstStep()).toBe(SELECTION_WITH_SECRET);
    expect(sentToFirstStep()).not.toMatch(PLACEHOLDER_PATTERN);

    const pasted = (pasteText as Mock).mock.calls[0][0] as string;
    expect(pasted).not.toMatch(PLACEHOLDER_PATTERN);
    expect(latencyOutcome()).toMatchObject({ outcome: "delivered" });
  });

  it("sends nothing when the mask-mode confirm is declined", async () => {
    mockSelection({ text: SELECTION_WITH_SECRET });
    setSecretGuardMode({ mode: "mask" });
    (confirmSecretSend as Mock).mockResolvedValue(false);

    const handler = registerComboHandler();
    await handler();

    expectComboNeverRan();
    expect(latencyOutcome()).toMatchObject({ outcome: "secret-declined" });
  });
});

/**
 * `redactLogContext` blanks any context key whose NAME merely CONTAINS
 * `clipboard`/`token`/`secret`/`password`/`selected_text`, with no error — so
 * the obvious name for a guard field silently persists as `"[REDACTED]"` and
 * destroys the diagnostic. The contexts below are the ones the handler
 * ACTUALLY logged during real presses, captured from the mock: a hand-written
 * copy of the same keys would keep passing after a rename in `correction.ts`,
 * which is precisely the failure this test exists to catch.
 */
describe("combo guard logging — log key redaction safety", () => {
  const comboHotkeyContexts = (): LogContext[] =>
    [logger.warn, logger.info]
      .flatMap((fn) => (fn as Mock).mock.calls)
      .filter(([scope]) => scope === "correction.hotkey")
      .map(([, , context]) => (context ?? {}) as LogContext);

  it.each([
    [
      "a stale-clipboard block",
      () => {
        mockSelection({ text: "a password copied 40 minutes ago", changed: false });
        (clipboardChangeTracker.clipboardAge as Mock).mockReturnValue({ ms: 2_400_000, origin: "change" });
      },
    ],
    [
      "a denied-app block",
      () => {
        mockSelection({
          text: "a vault entry",
          activeApp: { name: "1Password", bundleId: "com.1password.1password" },
        });
      },
    ],
    [
      "a large-selection Cancel",
      () => {
        mockSelection({ text: "x".repeat(40) });
        (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
          defaultGuardSettings({ maxSelectionChars: 10 }),
        );
        (confirmSelectionGuard as Mock).mockResolvedValue(false);
      },
    ],
    [
      "a secret-guard decline",
      () => {
        mockSelection({ text: SELECTION_WITH_SECRET });
        setSecretGuardMode({ mode: "confirm" });
        (confirmSecretSend as Mock).mockResolvedValue(false);
      },
    ],
  ])("survives the substring redactor unchanged after %s", async (_label, arrange) => {
    arrange();

    const handler = registerComboHandler();
    await handler();

    const contexts = comboHotkeyContexts();
    // A press that logged nothing would make every assertion below vacuous.
    expect(contexts.length).toBeGreaterThan(0);
    for (const context of contexts) {
      expect(redactLogContext(context)).toEqual(context);
    }
  });
});

/**
 * The two guard dialogs are the only awaits in this handler paced by a HUMAN,
 * so they are the ones that can outlive `COMBO_LOCK_MAX_HOLD_MS`. An abandoned
 * run must not resume on the user's click and walk on — the user has already
 * been told the combo failed, and the lock has already admitted the next press.
 */
describe("combo guards — a run the lock watchdog already abandoned stops at the dialog", () => {
  it("never opens the secret dialog, never starts the chain, and finishes exactly once", async () => {
    vi.useFakeTimers();
    try {
      mockSelection({ text: SELECTION_WITH_SECRET });
      (guardStore.getSelectionGuardSettings as Mock).mockReturnValue(
        defaultGuardSettings({ maxSelectionChars: 10 }),
      );
      setSecretGuardMode({ mode: "confirm" });
      (confirmSecretSend as Mock).mockResolvedValue(true);

      let answerDialog: ((proceed: boolean) => void) | undefined;
      (confirmSelectionGuard as Mock).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answerDialog = resolve;
          }),
      );

      const handler = registerComboHandler();
      const pressed = handler();

      // The watchdog trips while the dialog is still open.
      await vi.advanceTimersByTimeAsync(COMBO_LOCK_MAX_HOLD_MS + 1);
      await pressed;

      // The user answers Send, long after being told the run failed.
      answerDialog?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(confirmSecretSend).not.toHaveBeenCalled();
      expect(fixGrammar).not.toHaveBeenCalled();
      expect(pasteText).not.toHaveBeenCalled();
      expect(showCorrectionResultWindow).not.toHaveBeenCalled();
      expect(mainWindowSend).not.toHaveBeenCalledWith("start-loading");
      // The watchdog's own `abortActiveCombo()` repaints the ring as
      // "cancelling"; no step ever painted a "running" one.
      expect(
        (updateComboProgress as Mock).mock.calls.every(
          ([view]) => (view as { state: string }).state === "cancelling",
        ),
      ).toBe(true);
      expect(latencyOutcome()).toMatchObject({
        outcome: "failed",
        reason: "lock-watchdog",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
