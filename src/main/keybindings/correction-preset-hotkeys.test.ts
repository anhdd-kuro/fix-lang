/**
 * @file correction-preset-hotkeys.test.ts
 * @description End-to-end guard for preset hotkey registration: a built-in
 * materialized by `normalizeCorrectionSettings` is emitted AHEAD of the user's
 * custom presets, and `registerCorrectionShortcut` registers in array order
 * (first wins) — so without the normalize-side guard a new built-in default
 * silently outranks a stored preset already on that accelerator.
 *
 * Stored config goes through the real `normalizeCorrectionSettings`; only
 * `globalShortcut.register` and `logger` are observed.
 */
import { globalShortcut, Notification } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  keyBindings: {
    promptGen: "Control+Alt+P",
    profileSwitch: "Control+Alt+O",
  },
}));
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
  // `unregister` matters here too: `withComboCancel` (comboCancel.ts) always
  // calls it in its `finally`, on both the resolve and reject paths — an
  // unmocked call throws and masks whatever error the run actually failed
  // with, since that throw is itself caught and reported instead.
  globalShortcut: { register: vi.fn().mockReturnValue(true), unregister: vi.fn() },
  // A `vi.fn()`, not a plain class, so combo tests can assert exactly which
  // notification (if any) was constructed — e.g. proving E11's good-job
  // notification never fires inside a combo, or that a step failure raises
  // exactly one notification and not two. Must be a `function`, not an arrow:
  // `new Notification(...)` requires a constructible implementation.
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
  keybindingStore: { getKeyBindings: vi.fn(() => mocks.keyBindings) },
}));
vi.mock("~/features/correction/store/outputModeStore", () => ({
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("popup") },
}));
vi.mock("../../utils", () => ({
  getHighlightedTextWithActiveApp: vi
    .fn()
    .mockResolvedValue({ text: "some selected text", activeApp: null }),
  getAskContext: vi
    .fn()
    .mockResolvedValue({ text: "some selected text", source: "selection" }),
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
// `buildAppLocaleDirective` is mocked alongside `runAskFlow` because
// `buildComboRunDependencies` injects it into `runCombo` — a combo's
// `requiresInput` step composes its message through the same Ask contract.
vi.mock("./askFlow", () => ({
  runAskFlow: vi.fn(),
  buildAppLocaleDirective: vi.fn().mockReturnValue("App locale: en"),
}));
// The Ask branch resolves the press's environment before it opens the window.
// Stubbed here because it shells out to `defaults` and reads SQLite history —
// neither of which says anything about hotkey registration, which is what this
// file is about. `askEnvironment.test.ts` owns the real thing.
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
// `withHotkeyThrottle` stays REAL: it wraps every registered handler, so a stub
// pass-through would hide a throttle that swallowed the invocations these tests
// await. Its timestamp map is module state — hence the per-test reset below.
vi.mock("./utils", async (importOriginal) => {
  const real = await importOriginal<typeof KeybindingUtils>();
  return { ...real, checkShortcut: vi.fn(), handleError: vi.fn() };
});
// `notifications/error` reaches `overlay.html?asset`, which vite cannot parse
// as JS under vitest. Stub that leaf so `LocalizedError` stays real.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
import { redactLogContext } from "~/features/logs/shared/logging";
import {
  getDefaultCorrectionSettings,
  getProfileSetting,
  normalizeCorrectionSettings,
} from "~/features/providers/store/apiStore";
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
} from "~/prompts/correction";
import { runAskFlow } from "./askFlow";
import { abortActiveCombo, resetActiveComboForTests } from "./comboCancel";
import { resetComboLockForTests } from "./comboLock";
import {
  COMBO_LOCK_MAX_HOLD_MS,
  ComboLockWatchdogError,
  registerCorrectionShortcut,
} from "./correction";
import { resetHotkeyThrottleForTests, handleError  } from "./utils";
import {
  getAskContext,
  getHighlightedTextWithActiveApp,
  pasteText,
} from "../../utils";
import { fixGrammar } from "../ai.request";
import { logger } from "../logging/logService";
import {
  hideOverlaySpinner,
  showOverlaySpinner,
  updateComboProgress,
} from "../webViewWindows";
import { showAskInputWindow } from "../webViewWindows/askInputWindow";
import { showCorrectionResultWindow } from "../webViewWindows/correctionResultWindow";
import type * as KeybindingUtils from "./utils";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";
import type { LogContext } from "~/features/logs/shared/logging";

/** Translate's built-in default accelerator — the one a stored preset claims. */
const TRANSLATE_DEFAULT_HOTKEY = "Control+Shift+T";
const STOLEN_FROM_PRESET_ID = "custom-translator";

const storedBuiltIn = (id: string, name: string, hotkey: string) => ({
  id,
  name,
  hotkey,
  systemPrompt: `${name} prompt.`,
  model: "openai/gpt-4.1-mini",
  isBuiltIn: true,
});

/** A valid 2-step combo referencing two real built-in presets. */
const storedCombo = (overrides: Record<string, unknown> = {}) => ({
  id: "combo-1",
  name: "Polish and Summarize",
  hotkey: "Control+Alt+K",
  steps: [
    { id: "s1", presetId: "correction" },
    { id: "s2", presetId: "summarize" },
  ],
  schemaVersion: 1,
  ...overrides,
});

const fixGrammarResult = (overrides: Record<string, unknown> = {}) => ({
  correctedText: "some selected text",
  promptTokens: 10,
  completionTokens: 5,
  model: "openai/gpt-4.1-mini",
  provider: "openai",
  resolvedModel: "openai/gpt-4.1-mini",
  presetName: "whichever",
  ...overrides,
});

/**
 * A pre-existing profile: every built-in EXCEPT Translate, plus a custom preset
 * the user put on Translate's default accelerator. Translate is therefore
 * materialized from the defaults on read, and would claim the same key.
 */
const STORED_WITH_CUSTOM_ON_A_BUILTIN_DEFAULT = {
  presets: [
    storedBuiltIn("correction", "Correction", "Control+Shift+F"),
    storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
    storedBuiltIn(
      "prompt-optimization",
      "Prompt optimization",
      "Control+Shift+D",
    ),
    {
      id: STOLEN_FROM_PRESET_ID,
      name: "My Translator",
      hotkey: TRANSLATE_DEFAULT_HOTKEY,
      systemPrompt: "Translate the way I like it.",
      model: "openai/gpt-4.1-mini",
      isBuiltIn: false,
    },
  ],
  selectedPresetId: "correction",
};

const fakeMainWindow = () =>
  ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow;

type RegisterCall = [string, () => Promise<void>];

const registerFrom = (stored: unknown): RegisterCall[] => {
  (getProfileSetting as Mock).mockImplementation((key: string) =>
    key === "models" ? [] : normalizeCorrectionSettings(stored),
  );
  (fixGrammar as Mock).mockResolvedValue({
    correctedText: "some corrected text",
    promptTokens: 10,
    completionTokens: 5,
    model: "openai/gpt-4.1-mini",
    provider: "openai",
    resolvedModel: "openai/gpt-4.1-mini",
    presetName: "whichever",
  });

  registerCorrectionShortcut(fakeMainWindow());

  return (globalShortcut.register as Mock).mock.calls as RegisterCall[];
};

const presetIdBehindHandler = async (
  handler: () => Promise<void>,
): Promise<unknown> => {
  (logger.info as Mock).mockClear();
  await handler();
  const triggered = (logger.info as Mock).mock.calls.find(
    ([scope, message]) => scope === "correction.hotkey" && message === "Hotkey triggered",
  );
  return (triggered?.[2] as { presetId?: unknown } | undefined)?.presetId;
};

describe("correction preset hotkeys — a materialized built-in never outranks a stored preset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
  });

  it("registers the stolen-from stored preset on the contested accelerator", async () => {
    const calls = registerFrom(STORED_WITH_CUSTOM_ON_A_BUILTIN_DEFAULT);
    const contested = calls.filter(
      ([shortcut]) => shortcut === TRANSLATE_DEFAULT_HOTKEY,
    );

    expect(contested).toHaveLength(1);
    await expect(presetIdBehindHandler(contested[0][1])).resolves.toBe(
      STOLEN_FROM_PRESET_ID,
    );
  });

  it("attempts no registration at all for the blanked built-in", () => {
    const calls = registerFrom(STORED_WITH_CUSTOM_ON_A_BUILTIN_DEFAULT);
    const shortcuts = calls.map(([shortcut]) => shortcut);

    // Every default EXCEPT Translate materializes with its own default hotkey
    // (derived, not re-pinned, so a future added preset does not go stale
    // here); Translate itself is blanked (contested) and adds no call; the
    // stored custom preset registers last, on the accelerator it stole.
    const nonTranslateDefaultHotkeys = getDefaultCorrectionSettings()
      .presets.filter((preset) => preset.id !== "translate")
      .map((preset) => preset.hotkey);

    expect(shortcuts).toEqual([
      ...nonTranslateDefaultHotkeys,
      TRANSLATE_DEFAULT_HOTKEY,
    ]);
    expect(shortcuts).not.toContain("");
    expect(logger.warn).not.toHaveBeenCalledWith(
      "correction.register",
      "Skipping duplicate correction shortcut",
      expect.anything(),
    );
  });

  it("still registers every built-in default when nothing is contested", () => {
    const calls = registerFrom({
      presets: [storedBuiltIn("correction", "Correction", "Control+Shift+F")],
      selectedPresetId: "correction",
    });

    // Derived from the factory itself (not re-pinned to a literal list) so
    // this test does not go stale every time a new built-in preset is added.
    const allDefaultHotkeys = getDefaultCorrectionSettings().presets.map(
      (preset) => preset.hotkey,
    );

    expect(calls.map(([shortcut]) => shortcut)).toEqual(allDefaultHotkeys);
  });

  it("registers the two new built-ins on their literal accelerators for a six-default profile", async () => {
    // Deliberately hardcoded, NOT derived from getDefaultCorrectionSettings():
    // a generic assertion here would corrupt in lockstep with a mutated
    // factory hotkey and never catch the regression.
    const calls = registerFrom({
      presets: [storedBuiltIn("correction", "Correction", "Control+Shift+F")],
      selectedPresetId: "correction",
    });
    const shortcuts = calls.map(([shortcut]) => shortcut);

    expect(shortcuts).toContain("Control+Shift+B");
    expect(shortcuts).toContain("Control+Shift+R");

    const businessWritingCall = calls.find(
      ([shortcut]) => shortcut === "Control+Shift+B",
    );
    const structuredTextCall = calls.find(
      ([shortcut]) => shortcut === "Control+Shift+R",
    );
    expect(businessWritingCall).toBeDefined();
    expect(structuredTextCall).toBeDefined();
    await expect(
      presetIdBehindHandler(businessWritingCall?.[1] as () => Promise<void>),
    ).resolves.toBe(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    await expect(
      presetIdBehindHandler(structuredTextCall?.[1] as () => Promise<void>),
    ).resolves.toBe(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
  });
});

describe("correction preset hotkeys — reserved app shortcuts still win", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
  });

  it("skips a preset hotkey equal to a REMAPPED promptGen, with a correction.register warn", () => {
    mocks.keyBindings = {
      // User remapped promptGen onto what a preset uses.
      promptGen: "Control+Shift+F",
      profileSwitch: "Control+Alt+O",
    };

    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
        storedBuiltIn(
          "prompt-optimization",
          "Prompt optimization",
          "Control+Shift+D",
        ),
        storedBuiltIn("translate", "Translate", TRANSLATE_DEFAULT_HOTKEY),
      ],
      selectedPresetId: "correction",
    });

    expect(calls.map(([shortcut]) => shortcut)).not.toContain(
      "Control+Shift+F",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "correction.register",
      "Skipping conflicting correction shortcut",
      { presetId: "correction" },
    );
  });

  it("skips a preset hotkey equal to a REMAPPED profileSwitch, with a correction.register warn", () => {
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: TRANSLATE_DEFAULT_HOTKEY,
    };

    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
        storedBuiltIn(
          "prompt-optimization",
          "Prompt optimization",
          "Control+Shift+D",
        ),
        storedBuiltIn("translate", "Translate", TRANSLATE_DEFAULT_HOTKEY),
      ],
      selectedPresetId: "correction",
    });

    expect(calls.map(([shortcut]) => shortcut)).not.toContain(
      TRANSLATE_DEFAULT_HOTKEY,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "correction.register",
      "Skipping conflicting correction shortcut",
      { presetId: "translate" },
    );
  });

  // The end state of the reserved-accelerator guard in `normalizeCorrectionSettings`,
  // asserted here rather than on the store: a MATERIALIZED default that would
  // land on a remapped app binding must arrive with no hotkey at all, so there
  // is nothing for this registrar to skip. The two tests above cover the other
  // side — a STORED hotkey keeps its value and IS skipped here.
  it("has nothing to skip for a materialized built-in whose default equals a REMAPPED promptGen", () => {
    mocks.keyBindings = {
      // User remapped promptGen onto Business Writing's brand-new default.
      promptGen: "Control+Shift+B",
      profileSwitch: "Control+Alt+O",
    };

    const calls = registerFrom({
      presets: [storedBuiltIn("correction", "Correction", "Control+Shift+F")],
      selectedPresetId: "correction",
    });

    expect(calls.map(([shortcut]) => shortcut)).not.toContain(
      "Control+Shift+B",
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      "correction.register",
      "Skipping conflicting correction shortcut",
      { presetId: DEFAULT_BUSINESS_WRITING_PRESET_ID },
    );
    // The uncontested new built-in still registers normally.
    expect(calls.map(([shortcut]) => shortcut)).toContain("Control+Shift+R");
  });
});

describe("correction preset hotkeys — the combo cancel accelerator is never registered", () => {
  // Deliberately a literal, not the imported constant: derived from the same
  // symbol the registrar reads, this would corrupt in lockstep with a mutated
  // accelerator and stop proving the chord is skipped at all.
  const COMBO_CANCEL_CHORD = "Control+Escape";

  const legacyCancelGrabber = {
    id: STOLEN_FROM_PRESET_ID,
    name: "Legacy Cancel Grabber",
    hotkey: COMBO_CANCEL_CHORD,
    systemPrompt: "Saved before the chord was reserved.",
    model: "openai/gpt-4.1-mini",
    isBuiltIn: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
  });

  // C6 layer 3, the migration path: `validateHotkeys` only runs pre-save, so a
  // profile stored before that gate existed is never re-validated. Without this
  // skip the preset registers first and the combo run's own registration
  // returns false — cancel silently gone.
  it("skips a STORED preset holding Control+Escape, with a correction.register warn", () => {
    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        legacyCancelGrabber,
      ],
      selectedPresetId: "correction",
    });

    expect(calls.map(([shortcut]) => shortcut)).not.toContain(COMBO_CANCEL_CHORD);
    expect(logger.warn).toHaveBeenCalledWith(
      "correction.register",
      "Skipping conflicting correction shortcut",
      { presetId: STOLEN_FROM_PRESET_ID },
    );
  });

  it("reserves it unconditionally — not only when an app keybinding happens to hold it", () => {
    // Both app bindings are elsewhere; the reservation is static.
    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        legacyCancelGrabber,
      ],
      selectedPresetId: "correction",
    });

    expect(calls.map(([shortcut]) => shortcut)).not.toContain(COMBO_CANCEL_CHORD);
    // The rest of the profile is untouched by the skip.
    expect(calls.map(([shortcut]) => shortcut)).toContain("Control+Shift+F");
  });
});

describe("correction preset hotkeys — Ask AI requiresInput branch", () => {
  const ASK_HOTKEY = "Control+Shift+A";

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "some selected text",
      activeApp: null,
    });
    (getAskContext as Mock).mockResolvedValue({
      text: "some selected text",
      source: "selection",
    });
  });

  const singleBuiltInProfile = {
    presets: [storedBuiltIn("correction", "Correction", "Control+Shift+F")],
    selectedPresetId: "correction",
  };

  /**
   * The Ask preset's prompt as the profile under test actually holds it — read
   * from the same defaults `normalizeCorrectionSettings` materializes it from,
   * so the pin cannot go stale when the bundled prompt is edited.
   *
   * Pinned rather than `expect.any(String)` because the whole claim of the
   * transparency row is that it shows the prompt that WILL RUN: `any(String)`
   * passes for another preset's prompt, for `""`, and for the snapshot captured
   * at registration time that the code says must not be used.
   */
  const askDefaultSystemPrompt = (): string => {
    const preset = getDefaultCorrectionSettings().presets.find(
      ({ id }) => id === DEFAULT_ASK_PRESET_ID,
    );
    if (!preset?.systemPrompt) {
      throw new Error("The Ask AI default preset has no system prompt.");
    }
    return preset.systemPrompt;
  };

  it("registers Control+Shift+A for the Ask AI preset", async () => {
    const calls = registerFrom(singleBuiltInProfile);
    const shortcuts = calls.map(([shortcut]) => shortcut);

    expect(shortcuts).toContain(ASK_HOTKEY);

    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    expect(askCall).toBeDefined();
    await expect(
      presetIdBehindHandler(askCall?.[1] as () => Promise<void>),
    ).resolves.toBe(DEFAULT_ASK_PRESET_ID);
  });

  it("opens the Ask input window instead of aborting when nothing is selected, and never fires the noTextSelected notification", async () => {
    (getAskContext as Mock).mockResolvedValue({ text: "", source: "clipboard" });

    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    await askCall?.[1]();

    expect(showAskInputWindow).toHaveBeenCalledWith(
      {
        presetId: DEFAULT_ASK_PRESET_ID,
        context: "",
        contextSource: "clipboard",
        systemPrompt: askDefaultSystemPrompt(),
        contextDirectives: "App locale: en\nSystem language: en-US",
      },
      expect.objectContaining({
        onSubmit: expect.any(Function),
        onCancel: expect.any(Function),
      }),
    );
    expect(handleError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "notifications.error.noTextSelected.body",
      }),
    );
  });

  it("reads via getAskContext, not the combined active-app read, and carries the source through to the window", async () => {
    // Two properties in one. Ask AI never uses source-app context, so it must
    // not pay for the combined read at all. And when the copy produced nothing,
    // the clipboard it falls back to reaches the window LABELLED — the window
    // says "From clipboard" over text that may be minutes old, instead of
    // presenting it as what the user just highlighted. That label is the whole
    // reason this path may attach the clipboard: an earlier version refused it
    // outright, which removed the only context the feature ever had.
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "should never be read here",
      activeApp: null,
    });
    (getAskContext as Mock).mockResolvedValue({
      text: "text the user copied by hand",
      source: "clipboard",
    });

    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    await askCall?.[1]();

    expect(getAskContext).toHaveBeenCalled();
    expect(getHighlightedTextWithActiveApp).not.toHaveBeenCalled();
    expect(showAskInputWindow).toHaveBeenCalledWith(
      {
        presetId: DEFAULT_ASK_PRESET_ID,
        context: "text the user copied by hand",
        contextSource: "clipboard",
        systemPrompt: askDefaultSystemPrompt(),
        contextDirectives: "App locale: en\nSystem language: en-US",
      },
      expect.objectContaining({
        onSubmit: expect.any(Function),
        onCancel: expect.any(Function),
      }),
    );
  });

  /**
   * `redactLogContext` blanks any context KEY merely CONTAINING `clipboard`,
   * `token`, `secret` or `selected_text` — silently, with no error, leaving
   * `"[REDACTED]"` where a number was. That is how `clipboardRead` (now
   * `selectionPoll`) and `replyTokens` (now `replyLength`) were caught, and
   * every key the Ask press emits is one rename away from the same fate. The
   * REAL redactor runs here; the mocked logger above never reaches it.
   */
  it("emits only log keys that survive the real redactor, latency phases included", async () => {
    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    await askCall?.[1]();

    const askContextResolved = (logger.debug as Mock).mock.calls.find(
      ([scope, message]) =>
        scope === "correction.hotkey" && message === "Ask context resolved",
    )?.[2] as LogContext;

    // Asserted present, not merely redaction-clean: a key that stopped being
    // emitted would pass a redaction check trivially.
    expect(askContextResolved).toMatchObject({
      contextLength: expect.any(Number),
      contextAttached: expect.any(Boolean),
      directivesLength: expect.any(Number),
      recentTransformCount: expect.any(Number),
      keyboardInputSourceRead: expect.any(Boolean),
    });
    expect(redactLogContext(askContextResolved)).toEqual(askContextResolved);

    const latencyLine = (logger.info as Mock).mock.calls.find(
      ([scope, message]) =>
        scope === "correction.latency" && message === "Transform latency",
    )?.[2] as LogContext;

    // The phase the environment read reports under. Named `environmentRead`
    // precisely because it has to survive the check on the next line.
    expect(Object.keys(latencyLine.phases as object)).toEqual([
      "selectionRead",
      "environmentRead",
    ]);
    expect(redactLogContext(latencyLine)).toEqual(latencyLine);
  });

  it("resolves the system prompt at PRESS time, not from the preset captured at registration", async () => {
    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);

    // The profile changes between registering the shortcut and pressing it —
    // an edit in Settings, or a profile switch. `fixGrammar` looks the preset
    // up again at submit, so the transparency row would be stating a prompt
    // the request is not going to carry if it used the registration snapshot.
    (getProfileSetting as Mock).mockImplementation((key: string) =>
      key === "models"
        ? []
        : normalizeCorrectionSettings({
            presets: [
              storedBuiltIn("correction", "Correction", "Control+Shift+F"),
              storedBuiltIn(DEFAULT_ASK_PRESET_ID, "Ask AI", ASK_HOTKEY),
            ],
            selectedPresetId: "correction",
          }),
    );

    await askCall?.[1]();

    expect(showAskInputWindow).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "Ask AI prompt." }),
      expect.anything(),
    );
    // The edited prompt is genuinely different from the one registration saw,
    // so the assertion above cannot pass by accident.
    expect(askDefaultSystemPrompt()).not.toBe("Ask AI prompt.");
  });

  it("still aborts a non-requiresInput preset with the noTextSelected notification when nothing is selected", async () => {
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({ text: "", activeApp: null });

    const calls = registerFrom(singleBuiltInProfile);
    const correctionCall = calls.find(
      ([shortcut]) => shortcut === "Control+Shift+F",
    );
    await correctionCall?.[1]();

    expect(showAskInputWindow).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "notifications.error.noTextSelected.body",
      }),
    );
  });

  it("wires the input window's onSubmit handler to runAskFlow with the current selection as context", async () => {
    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    await askCall?.[1]();

    const [, handlers] = (showAskInputWindow as Mock).mock.calls[0];
    handlers.onSubmit("What does this mean?");

    expect(runAskFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: expect.objectContaining({ id: DEFAULT_ASK_PRESET_ID }),
        context: "some selected text",
        question: "What does this mean?",
        // The SAME string the window was handed, not a second rendering of it.
        directives: "App locale: en\nSystem language: en-US",
      }),
    );
  });

  it("wires the input window's onCancel handler to a no-op that never calls runAskFlow", async () => {
    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    await askCall?.[1]();

    const [, handlers] = (showAskInputWindow as Mock).mock.calls[0];
    handlers.onCancel();

    expect(runAskFlow).not.toHaveBeenCalled();
  });
});

describe("correction preset hotkeys — overlay spinner timing", () => {
  const singleBuiltInProfile = {
    presets: [storedBuiltIn("correction", "Correction", "Control+Shift+F")],
    selectedPresetId: "correction",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
  });

  it("shows the overlay spinner via the combined read's callback, as soon as the frontmost-app-read-then-copy script returns", async () => {
    (getHighlightedTextWithActiveApp as Mock).mockImplementation(
      async (onFrontmostReadAndKeystrokeSent?: () => void) => {
        // Nothing has resolved the selection yet at this point — mirrors the
        // real implementation calling this callback before its own
        // clipboard-change poll.
        expect(showOverlaySpinner).not.toHaveBeenCalled();
        onFrontmostReadAndKeystrokeSent?.();
        return { text: "some selected text", activeApp: null };
      },
    );

    const calls = registerFrom(singleBuiltInProfile);
    const correctionCall = calls.find(([shortcut]) => shortcut === "Control+Shift+F");
    await correctionCall?.[1]();

    expect(showOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
  });

  it("still hides the overlay spinner on the noTextSelected abort, even though it was already shown earlier", async () => {
    (getHighlightedTextWithActiveApp as Mock).mockImplementation(
      async (onFrontmostReadAndKeystrokeSent?: () => void) => {
        onFrontmostReadAndKeystrokeSent?.();
        return { text: "", activeApp: null };
      },
    );

    const calls = registerFrom(singleBuiltInProfile);
    const correctionCall = calls.find(([shortcut]) => shortcut === "Control+Shift+F");
    await correctionCall?.[1]();

    expect(showOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(handleError).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: "notifications.error.noTextSelected.body" }),
    );
  });
});

/**
 * E1 — combo hotkeys register in the SAME `registerCorrectionShortcut` pass
 * as presets, sharing the one `registeredShortcuts` dedup set and the same
 * `reservedShortcuts` skip, so a combo cannot silently win a race a preset
 * would otherwise have refused (and vice versa).
 */
describe("correction preset hotkeys — combo hotkeys register in the same pass as presets", () => {
  const twoPresetProfile = (combos: unknown[]) => ({
    presets: [
      storedBuiltIn("correction", "Correction", "Control+Shift+F"),
      storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
    ],
    selectedPresetId: "correction",
    combos,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
    // Defensive: an earlier describe block's `mockImplementation` on this mock
    // outlives `vi.clearAllMocks()` (which clears call history, not
    // implementations), so restore the default selection here rather than
    // relying on suite ordering.
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "some selected text",
      activeApp: null,
    });
  });

  it("registers a combo hotkey on a free chord", () => {
    const calls = registerFrom(twoPresetProfile([storedCombo()]));

    expect(calls.map(([shortcut]) => shortcut)).toContain("Control+Alt+K");
  });

  it("skips a combo hotkey a preset already took, with a correction.register warn, and keeps the preset's own registration", () => {
    const calls = registerFrom(
      twoPresetProfile([storedCombo({ hotkey: "Control+Shift+F" })]),
    );
    const contested = calls.filter(([shortcut]) => shortcut === "Control+Shift+F");

    expect(contested).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "correction.register",
      "Skipping duplicate correction shortcut",
      { comboId: "combo-1" },
    );
  });

  it.each([
    ["promptGen", "Control+Alt+P"],
    ["profileSwitch", "Control+Alt+O"],
    ["the reserved combo-cancel chord", COMBO_CANCEL_ACCELERATOR],
  ])("skips a combo hotkey equal to %s, with a correction.register warn", (_label, chord) => {
    const calls = registerFrom(twoPresetProfile([storedCombo({ hotkey: chord })]));

    expect(calls.map(([shortcut]) => shortcut)).not.toContain(chord);
    expect(logger.warn).toHaveBeenCalledWith(
      "correction.register",
      "Skipping conflicting correction shortcut",
      { comboId: "combo-1" },
    );
  });

  it("re-registers a combo across two registration passes with a changed hotkey, mirroring reloadHotkeys' unregister-then-register-again cycle", () => {
    const first = registerFrom(
      twoPresetProfile([storedCombo({ hotkey: "Control+Alt+K" })]),
    );
    expect(first.map(([shortcut]) => shortcut)).toContain("Control+Alt+K");

    // `reloadHotkeys()` (src/main/keybindings/index.ts) calls
    // `globalShortcut.unregisterAll()` then re-invokes `registerCorrectionShortcut`
    // on the (possibly changed) profile — simulated here by a fresh call with a
    // different stored hotkey, matching a settings save or profile switch.
    (globalShortcut.register as Mock).mockClear();
    const second = registerFrom(
      twoPresetProfile([storedCombo({ hotkey: "Control+Alt+M" })]),
    );

    expect(second.map(([shortcut]) => shortcut)).toContain("Control+Alt+M");
    expect(second.map(([shortcut]) => shortcut)).not.toContain("Control+Alt+K");
  });
});

/**
 * E11 — the single-preset path's "good job" notification
 * (`buildCorrectionGoodJobNotification`, gated on
 * `preset.id === DEFAULT_CORRECTION_PRESET_ID` and unchanged output) must
 * never fire for a combo, even when its first step is that very preset and
 * produces unchanged output. The combo handler in `correction.ts` never
 * performs that check at all — this test is the regression guard against a
 * future copy-paste of the single-preset branch into the combo path.
 */
describe("correction preset hotkeys — combo hotkeys suppress the single-preset good-job notification (E11)", () => {
  const singleComboProfile = () => ({
    presets: [
      storedBuiltIn(DEFAULT_CORRECTION_PRESET_ID, "Correction", "Control+Shift+F"),
      storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
    ],
    selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
    combos: [storedCombo({ hotkey: "Control+Alt+K" })],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
    // Defensive: an earlier describe block's `mockImplementation` on this mock
    // outlives `vi.clearAllMocks()` (which clears call history, not
    // implementations), so restore the default selection here rather than
    // relying on suite ordering.
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "some selected text",
      activeApp: null,
    });
  });

  it("constructs no Notification when the combo's first step is the default correction preset and its output is unchanged", async () => {
    // Every step returns the SAME text the selection started with (unchanged
    // output) — exactly the condition that triggers the good-job notification
    // on the single-preset path when the first step's preset is Correction.
    (fixGrammar as Mock).mockResolvedValue(fixGrammarResult({ correctedText: "some selected text" }));

    const calls = registerFrom(singleComboProfile());
    const comboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    await comboCall?.[1]();

    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(Notification).not.toHaveBeenCalled();
  });
});

/**
 * E2/E7 — nothing is pasted (or popped up) on a failed or cancelled combo
 * run; delivery happens exactly once, only after every step has completed.
 * Also covers E4: exactly one localized notification, naming the failing
 * step and its 1-based position for a step failure, and a distinct message
 * for a cancel.
 */
describe("correction preset hotkeys — nothing is pasted on a failed or cancelled combo run", () => {
  const twoStepComboProfile = () => ({
    presets: [
      storedBuiltIn("correction", "Correction", "Control+Shift+F"),
      storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
    ],
    selectedPresetId: "correction",
    combos: [storedCombo({ hotkey: "Control+Alt+K" })],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
    // Defensive: an earlier describe block's `mockImplementation` on this mock
    // outlives `vi.clearAllMocks()` (which clears call history, not
    // implementations), so restore the default selection here rather than
    // relying on suite ordering.
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "some selected text",
      activeApp: null,
    });
  });

  it("delivers nothing and shows exactly one notification naming the failing step and its position when a step fails", async () => {
    (fixGrammar as Mock)
      .mockResolvedValueOnce(fixGrammarResult({ correctedText: "step one output" }))
      // E6 — whitespace-only intermediate output is an error, not a silent
      // pass-through, so this is what actually fails step 2.
      .mockResolvedValueOnce(fixGrammarResult({ correctedText: "   " }));

    const calls = registerFrom(twoStepComboProfile());
    const comboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    await comboCall?.[1]();

    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();

    expect(Notification).toHaveBeenCalledTimes(1);
    const [payload] = (Notification as Mock).mock.calls[0] as [{ title: string; body: string }];
    // "Step 2 of 2 — Summarize" — position and preset name of the failing step.
    expect(payload.body).toContain("2");
    expect(payload.body).toContain("Summarize");
  });

  it("delivers nothing and shows a distinct cancel notification (not the step-failed one) when Control+Escape aborts the run mid-chain", async () => {
    let cancelPressHandler: (() => void) | undefined;
    (globalShortcut.register as Mock).mockImplementation(
      (accelerator: string, handler: () => void) => {
        if (accelerator === COMBO_CANCEL_ACCELERATOR) {
          cancelPressHandler = handler;
        }
        return true;
      },
    );

    (fixGrammar as Mock).mockImplementationOnce(async () => {
      // Fires the cancel accelerator while step 1 is still in flight — the
      // abort is only observed at the NEXT step boundary (cooperative
      // cancellation), so step 1 still completes and step 2 never starts.
      cancelPressHandler?.();
      return fixGrammarResult({ correctedText: "step one output" });
    });

    const calls = registerFrom(twoStepComboProfile());
    const comboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    await comboCall?.[1]();

    expect(fixGrammar).toHaveBeenCalledTimes(1);
    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
    expect(Notification).toHaveBeenCalledTimes(1);
  });

  it("delivers nothing and shows the combo-invalid notification when the stored combo fails t0 re-validation", async () => {
    // Sanitizer admits an empty `steps` array (V3); `validateCombo` rejects it
    // at t0, before any request runs.
    const calls = registerFrom({
      presets: [storedBuiltIn("correction", "Correction", "Control+Shift+F")],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Alt+K", steps: [] })],
    });
    const comboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    await comboCall?.[1]();

    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
    expect(Notification).toHaveBeenCalledTimes(1);
  });
});

/**
 * R2 (board decision) — the E10 lock wraps the WHOLE hotkey handler, above
 * the selection read and the spinner, not just `runCombo`. A lock placed
 * only around `runCombo` cannot refuse a second press: by the time it would
 * be reached, the second press has already read the selection and shown its
 * own spinner.
 */
describe("correction preset hotkeys — a second combo press is refused while one is already running (E10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
    // Defensive: an earlier describe block's `mockImplementation` on this mock
    // outlives `vi.clearAllMocks()` (which clears call history, not
    // implementations), so restore the default selection here rather than
    // relying on suite ordering.
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "some selected text",
      activeApp: null,
    });
  });

  it("refuses a second, DIFFERENT combo hotkey pressed while the first is still running, with a distinct lock-busy notification, and still lets the first run finish", async () => {
    // Two different accelerators on purpose (R2/D3): `withHotkeyThrottle` is
    // per-accelerator and already swallows a rapid repeat of the SAME chord
    // on its own, so re-pressing one accelerator would prove the throttle,
    // not the lock. Two different combo hotkeys are the only way to prove
    // the lock, matching the design's own "fire two different handlers" test.
    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
      ],
      selectedPresetId: "correction",
      combos: [
        storedCombo({ hotkey: "Control+Alt+K" }),
        storedCombo({ id: "combo-2", name: "Second Combo", hotkey: "Control+Alt+L" }),
      ],
    });

    let releaseStepOne: (() => void) | undefined;
    const stepOneGate = new Promise<void>((resolve) => {
      releaseStepOne = resolve;
    });
    // Set AFTER `registerFrom`, which sets its own default `fixGrammar`
    // resolved value as part of registering — a mock set before that call
    // would just be overwritten by it.
    (fixGrammar as Mock).mockImplementation(async () => {
      await stepOneGate;
      return fixGrammarResult();
    });

    const firstComboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    const secondComboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+L");

    // `withComboLock` acquires its lock SYNCHRONOUSLY, before the handler's
    // first genuine `await` — so by the time this call returns control (a
    // pending promise), the second, different combo's press below is
    // already refused.
    const firstRun = firstComboCall?.[1]();
    await secondComboCall?.[1]();

    expect(Notification).toHaveBeenCalledTimes(1);
    // Refused at the handler boundary, ABOVE the selection read (R2) — the
    // second combo never reads the selection at all.
    expect(getHighlightedTextWithActiveApp).toHaveBeenCalledTimes(1);

    releaseStepOne?.();
    await firstRun;

    expect(fixGrammar).toHaveBeenCalledTimes(2);
    // Exactly one notification total: the lock-busy refusal. The first run's
    // own successful completion shows none.
    expect(Notification).toHaveBeenCalledTimes(1);
  });
});

/**
 * f2 (this card's fix) — a handler stuck on a hung `exec()` deep in
 * `src/utils.ts` (a wedged frontmost app: the combined selection read's own
 * fallback, or `pasteText`'s keystroke, both have no OS-level timeout) must
 * not hold `withComboLock`'s lock forever. Without the watchdog around the
 * locked body, `withComboLock`'s `finally` never runs because the body
 * promise never settles, and every later combo press is refused with a now-
 * false "Another combo is already running" until the app restarts.
 */
describe("correction preset hotkeys — a stuck combo handler releases the lock instead of disabling combos forever (f2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    vi.useFakeTimers();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("frees the lock once COMBO_LOCK_MAX_HOLD_MS elapses, so a later different combo press is not refused as busy", async () => {
    // Simulates the wedged-frontmost-app scenario: the combined selection
    // read never settles, mirroring a real hang in its unbounded
    // `sendCopyKeystroke` fallback (src/utils.ts).
    (getHighlightedTextWithActiveApp as Mock).mockReturnValue(new Promise(() => undefined));

    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
      ],
      selectedPresetId: "correction",
      combos: [
        storedCombo({ hotkey: "Control+Alt+K" }),
        storedCombo({ id: "combo-2", name: "Second Combo", hotkey: "Control+Alt+L" }),
      ],
    });

    const stuckComboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    const laterComboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+L");

    // Fire-and-forget on purpose: this press hangs forever without the
    // watchdog, so awaiting it directly would hang the test itself.
    void stuckComboCall?.[1]();
    expect(getHighlightedTextWithActiveApp).toHaveBeenCalledTimes(1);

    // Advance past the watchdog's ceiling; `advanceTimersByTimeAsync` also
    // flushes the microtasks the watchdog's rejection and `withComboLock`'s
    // `finally` need in order to actually run.
    await vi.advanceTimersByTimeAsync(COMBO_LOCK_MAX_HOLD_MS);

    expect(handleError).toHaveBeenCalledWith(expect.any(ComboLockWatchdogError));

    // The lock must be free now: a later, different combo press proceeds
    // past the lock check (reads the selection again) instead of being
    // refused as busy.
    void laterComboCall?.[1]();
    expect(getHighlightedTextWithActiveApp).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalledWith(
      "correction.hotkey",
      "Refused a second combo press while one is already running",
      expect.anything(),
    );
  });
});

/**
 * Finding A (board) — the lock watchdog used to free the lock and report a
 * failure WITHOUT aborting the still-running body. A slow-but-not-wedged
 * selection read (30-40s, the osascript-contention class `correction.ts`
 * already documents) plus a chain that legitimately uses close to its own
 * `COMBO_TOTAL_BUDGET_MS` pushes the whole handler past
 * `COMBO_LOCK_MAX_HOLD_MS` while `runCombo` is genuinely still alive, inside
 * `withComboCancel`, not stuck. Left alone, that abandoned run finishes on
 * its own schedule and calls `deliver` AFTER the user was already told (via
 * the watchdog's rejection) that it failed. The fix is `abortActiveCombo()`
 * inside the watchdog, before it rejects — this proves the whole chain: the
 * abort actually reaches `runCombo`'s live `AbortSignal` and blocks delivery,
 * not merely that a notification was shown.
 */
describe("correction preset hotkeys — the lock watchdog aborts the still-running combo instead of abandoning it (Finding A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    vi.useFakeTimers();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the live run at the watchdog ceiling, so a step that resolves afterward still delivers nothing", async () => {
    // The selection read alone takes 40s (real, per-run time; not stuck) —
    // long enough that, combined with the chain below, the WHOLE handler
    // crosses COMBO_LOCK_MAX_HOLD_MS (150s) while `runCombo`'s OWN clocks
    // (60s per step, 120s total, both counted from runCombo's own entry,
    // i.e. AFTER this read) are nowhere near tripping on their own.
    let releaseSelection: (() => void) | undefined;
    const selectionGate = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });
    (getHighlightedTextWithActiveApp as Mock).mockImplementation(async () => {
      await selectionGate;
      return { text: "some selected text", activeApp: null };
    });

    let releaseStep1: (() => void) | undefined;
    const step1Gate = new Promise<void>((resolve) => {
      releaseStep1 = resolve;
    });
    let releaseStep2: (() => void) | undefined;
    const step2Gate = new Promise<void>((resolve) => {
      releaseStep2 = resolve;
    });
    (fixGrammar as Mock)
      .mockImplementationOnce(async () => {
        await step1Gate;
        return fixGrammarResult({ correctedText: "step one output" });
      })
      .mockImplementationOnce(async () => {
        await step2Gate;
        return fixGrammarResult({ correctedText: "step two output" });
      });

    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
      ],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Alt+K" })],
    });
    const comboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");

    // Fire-and-forget: this handler outlives the watchdog ceiling itself.
    void comboCall?.[1]();

    await vi.advanceTimersByTimeAsync(40_000); // the slow-but-not-wedged read
    releaseSelection?.();
    await vi.advanceTimersByTimeAsync(0); // let runCombo start step 1

    await vi.advanceTimersByTimeAsync(58_000); // step 1 legitimately takes a while (under its own 60s cap)
    releaseStep1?.();
    await vi.advanceTimersByTimeAsync(0); // step 1 completes, step 2 starts

    // 40_000 + 58_000 + 52_000 = 150_000 = COMBO_LOCK_MAX_HOLD_MS. Step 2 is
    // still pending (its own budget-shrunk cap has not elapsed — that would
    // land 8s later) when the watchdog ceiling arrives.
    await vi.advanceTimersByTimeAsync(52_000);

    expect(handleError).toHaveBeenCalledWith(expect.any(ComboLockWatchdogError));
    // Nothing delivered yet — true even pre-fix, since step 2 has not
    // resolved. Not yet the load-bearing assertion.
    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();

    // Now let the abandoned run's own step 2 actually finish underneath —
    // exactly the "runCombo finishes and calls deliver" half of the finding.
    // Pre-fix (no `abortActiveCombo()` in the watchdog), the signal was never
    // aborted, so this resolves normally and `runCombo` proceeds straight to
    // `deliver` — the load-bearing assertions below fail without the fix.
    releaseStep2?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
    // Proves WHY nothing was delivered: the abandoned run recognized its own
    // cancellation, rather than merely never having gotten around to it.
    expect(logger.info).toHaveBeenCalledWith(
      "correction.hotkey",
      "Combo cancelling",
      expect.objectContaining({ comboId: "combo-1" }),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      "correction.hotkey",
      "Combo completed",
      expect.anything(),
    );
    // F3 (board, minor) — the watchdog's own trip already shows exactly one
    // notification (`handleError(ComboLockWatchdogError)` above); the
    // abandoned run's own cancellation must not show a second, redundant
    // "Combo Cancelled" banner for the same event.
    expect(Notification).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "correction.hotkey",
      "Combo cancelled by the lock watchdog; notification already shown by the watchdog's own handler",
      expect.objectContaining({ comboId: "combo-1" }),
    );
  });
});

/**
 * F1 (board finding) — `updateComboProgress` (card 04's overlay ring) had no
 * production caller: `RunComboDependencies` exposed no step-boundary seam,
 * and `runComboFromHotkey` never wired one. This is the assertion whose
 * absence let the whole card ship as dead code — a combo run must actually
 * reach `updateComboProgress`, not merely resolve.
 */
describe("correction preset hotkeys — the combo progress ring actually reaches updateComboProgress (Finding F1)", () => {
  const twoStepComboProfile = () => ({
    presets: [
      storedBuiltIn("correction", "Correction", "Control+Shift+F"),
      storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
    ],
    selectedPresetId: "correction",
    combos: [storedCombo({ hotkey: "Control+Alt+K" })],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "some selected text",
      activeApp: null,
    });
  });

  it("calls updateComboProgress with a running view for each of the combo's steps, in order", async () => {
    const calls = registerFrom(twoStepComboProfile());
    const comboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    await comboCall?.[1]();

    // The assertion F1 shipped without: a combo run must reach
    // updateComboProgress at all.
    expect(updateComboProgress).toHaveBeenCalled();
    expect(updateComboProgress).toHaveBeenCalledWith({
      total: 2,
      completed: 0,
      current: 1,
      state: "running",
    });
    expect(updateComboProgress).toHaveBeenCalledWith({
      total: 2,
      completed: 1,
      current: 2,
      state: "running",
    });
  });

  it("replays the last known progress with state 'cancelling' when Control+Escape aborts the run", async () => {
    let cancelPressHandler: (() => void) | undefined;
    (globalShortcut.register as Mock).mockImplementation(
      (accelerator: string, handler: () => void) => {
        if (accelerator === COMBO_CANCEL_ACCELERATOR) {
          cancelPressHandler = handler;
        }
        return true;
      },
    );

    (fixGrammar as Mock).mockImplementationOnce(async () => {
      // Fires while step 1's own progress view (current: 1) is the latest
      // one recorded — proves the replay carries THAT view, not a fresh or
      // blank one, since `withComboCancel`'s `onCancelling` has no visibility
      // into `runCombo`'s loop state on its own.
      cancelPressHandler?.();
      return fixGrammarResult({ correctedText: "step one output" });
    });

    const calls = registerFrom(twoStepComboProfile());
    const comboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    await comboCall?.[1]();

    expect(updateComboProgress).toHaveBeenCalledWith({
      total: 2,
      completed: 0,
      current: 1,
      state: "cancelling",
    });
  });
});

/**
 * F2 (board finding, first branch) — `withComboLockWatchdog`'s
 * `abortActiveCombo()` only reaches a run that has already entered
 * `withComboCancel`. A run still stuck in the selection read that PRECEDES
 * it — the exact unbounded `exec()` fallback the watchdog's own doc comment
 * cites — is unaffected: without the fix, once that read finally resolves,
 * the abandoned run proceeds into `runCombo` and can reach `deliver`
 * concurrently with whatever later run the freed lock already admitted.
 */
describe("correction preset hotkeys — the watchdog owns the whole handler, not just runCombo (Finding F2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    vi.useFakeTimers();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("an abandoned run whose stuck selection read resolves after the watchdog trips never reaches fixGrammar or delivery, and a later run is unaffected", async () => {
    let releaseSelection: (() => void) | undefined;
    (getHighlightedTextWithActiveApp as Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            // Simulates the wedged-frontmost-app hang — the combined
            // selection read's own unbounded `sendCopyKeystroke` fallback
            // (src/utils.ts) — outliving the watchdog ceiling.
            releaseSelection = () =>
              resolve({ text: "some selected text", activeApp: null });
          }),
      )
      .mockResolvedValue({ text: "some selected text", activeApp: null });

    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
      ],
      selectedPresetId: "correction",
      combos: [
        storedCombo({ hotkey: "Control+Alt+K" }),
        storedCombo({ id: "combo-2", name: "Second Combo", hotkey: "Control+Alt+L" }),
      ],
    });

    const stuckComboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+K");
    const laterComboCall = calls.find(([shortcut]) => shortcut === "Control+Alt+L");

    // Fire-and-forget: this press hangs in the selection read until released
    // below, well past the watchdog ceiling.
    void stuckComboCall?.[1]();
    expect(getHighlightedTextWithActiveApp).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(COMBO_LOCK_MAX_HOLD_MS);
    expect(handleError).toHaveBeenCalledWith(expect.any(ComboLockWatchdogError));

    // The lock is free — a different combo runs, and completes, cleanly.
    await laterComboCall?.[1]();
    expect(getHighlightedTextWithActiveApp).toHaveBeenCalledTimes(2);
    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(showCorrectionResultWindow).toHaveBeenCalledTimes(1);

    // Now the FIRST run's stuck selection read finally resolves — the
    // frontmost app un-wedges well after it was abandoned.
    releaseSelection?.();
    await vi.advanceTimersByTimeAsync(0);

    // The abandoned run must never proceed into fixGrammar or a second
    // delivery — without the fix, it resumes here and runs its own 2-step
    // chain to completion, doubling both.
    expect(fixGrammar).toHaveBeenCalledTimes(2);
    expect(showCorrectionResultWindow).toHaveBeenCalledTimes(1);
    expect(pasteText).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "correction.hotkey",
      "Combo handler resumed after the lock watchdog already abandoned it; skipping delivery",
      { comboId: "combo-1" },
    );
  });
});

/**
 * The cancel scope has to open BEFORE the selection read, not around
 * `runCombo` alone. `withComboCancel` is what publishes a run to
 * `abortActiveCombo()`, and `notifyActiveProfileChanged` calls exactly that:
 * with the scope opening late, a profile switch that lands while the read is
 * still in flight found no active combo, no-opped, and let the read finish —
 * after which every step re-resolved its `presetId` against the NEW profile,
 * sending a selection captured under profile A through profile B's provider
 * and key. Nothing failed; the request simply went somewhere the user never
 * authorized for that run.
 */
describe("correction preset hotkeys — a profile switch during the selection read aborts the combo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    resetActiveComboForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
  });

  it("makes no request at all when the switch lands mid-read, and reports it as a cancel", async () => {
    let releaseSelection: (() => void) | undefined;
    (getHighlightedTextWithActiveApp as Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSelection = () =>
            resolve({ text: "some selected text", activeApp: null });
        }),
    );

    const calls = registerFrom({
      presets: [
        storedBuiltIn("correction", "Correction", "Control+Shift+F"),
        storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
      ],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Alt+K" })],
    });

    const pressed = calls.find(([shortcut]) => shortcut === "Control+Alt+K")?.[1]();

    // The run is in flight and stuck in the read — this is exactly the window
    // the bug lived in.
    expect(getHighlightedTextWithActiveApp).toHaveBeenCalledTimes(1);
    expect(fixGrammar).not.toHaveBeenCalled();

    // What `notifyActiveProfileChanged` calls. A no-op before the fix.
    abortActiveCombo();

    releaseSelection?.();
    await pressed;

    expect(fixGrammar).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
    expect(Notification).toHaveBeenCalledTimes(1);
  });
});

/**
 * CLAUDE.md's latency contract: every press that reaches a handler logs one
 * `correction.latency` line and never two. The combo hotkey is a handler like
 * any other, and started life with no timer at all — every combo press was a
 * hole in the user-perceived latency data, on every outcome.
 */
describe("correction preset hotkeys — every combo press logs exactly one latency line", () => {
  const latencyLines = () =>
    (logger.info as Mock).mock.calls.filter(
      ([scope, message]) => scope === "correction.latency" && message === "Combo latency",
    );

  beforeEach(() => {
    vi.clearAllMocks();
    resetHotkeyThrottleForTests();
    resetComboLockForTests();
    resetActiveComboForTests();
    (globalShortcut.register as Mock).mockReturnValue(true);
    mocks.keyBindings = {
      promptGen: "Control+Alt+P",
      profileSwitch: "Control+Alt+O",
    };
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "some selected text",
      activeApp: null,
    });
  });

  const comboProfile = () => ({
    presets: [
      storedBuiltIn("correction", "Correction", "Control+Shift+F"),
      storedBuiltIn("summarize", "Summarize", "Control+Shift+S"),
    ],
    selectedPresetId: "correction",
    combos: [storedCombo({ hotkey: "Control+Alt+K" })],
  });

  it("logs one delivered line, with the phase breakdown, for a run that reaches the user", async () => {
    const calls = registerFrom(comboProfile());
    await calls.find(([shortcut]) => shortcut === "Control+Alt+K")?.[1]();

    const lines = latencyLines();
    expect(lines).toHaveLength(1);
    const [, , context] = lines[0] as [string, string, Record<string, unknown>];
    expect(context.outcome).toBe("delivered");
    expect(context.comboId).toBe("combo-1");
    expect(typeof context.totalMs).toBe("number");
    // The AI/delivery split is taken at `deliver`, the only seam between "all
    // steps ran" and "the user has it".
    expect(Object.keys(context.phases as Record<string, number>)).toEqual(
      expect.arrayContaining(["aiRequest", "delivery"]),
    );
  });

  it("logs one no-selection line, not zero, when the press aborts before any request", async () => {
    (getHighlightedTextWithActiveApp as Mock).mockResolvedValue({
      text: "",
      activeApp: null,
    });

    const calls = registerFrom(comboProfile());
    await calls.find(([shortcut]) => shortcut === "Control+Alt+K")?.[1]();

    const lines = latencyLines();
    expect(lines).toHaveLength(1);
    expect((lines[0] as [string, string, Record<string, unknown>])[2].outcome).toBe(
      "no-selection",
    );
  });

  it("logs one failed line when a step fails, and never a second one after it", async () => {
    (fixGrammar as Mock)
      .mockResolvedValueOnce(fixGrammarResult({ correctedText: "step one output" }))
      .mockResolvedValueOnce(fixGrammarResult({ correctedText: "   " }));

    const calls = registerFrom(comboProfile());
    await calls.find(([shortcut]) => shortcut === "Control+Alt+K")?.[1]();

    const lines = latencyLines();
    expect(lines).toHaveLength(1);
    expect((lines[0] as [string, string, Record<string, unknown>])[2].outcome).toBe(
      "failed",
    );
  });
});
