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
import { globalShortcut } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("~/main/accessibility/activeApp", () => ({
  getActiveApp: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/features/correction/store/keybindingStore", () => ({
  keybindingStore: { getKeyBindings: vi.fn(() => mocks.keyBindings) },
}));
vi.mock("~/features/correction/store/outputModeStore", () => ({
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("popup") },
}));
vi.mock("../../utils", () => ({
  getHighlightedText: vi.fn().mockResolvedValue("some selected text"),
  getHighlightedTextForOptionalContext: vi.fn().mockResolvedValue("some selected text"),
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
import {
  getDefaultCorrectionSettings,
  getProfileSetting,
  normalizeCorrectionSettings,
} from "~/features/providers/store/apiStore";
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
} from "~/prompts/correction";
import { runAskFlow } from "./askFlow";
import { registerCorrectionShortcut } from "./correction";
import { resetHotkeyThrottleForTests, handleError  } from "./utils";
import { getHighlightedText, getHighlightedTextForOptionalContext } from "../../utils";
import { fixGrammar } from "../ai.request";
import { logger } from "../logging/logService";
import { showAskInputWindow } from "../webViewWindows/askInputWindow";
import type * as KeybindingUtils from "./utils";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";

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
    (getHighlightedText as Mock).mockResolvedValue("some selected text");
    (getHighlightedTextForOptionalContext as Mock).mockResolvedValue("some selected text");
  });

  const singleBuiltInProfile = {
    presets: [storedBuiltIn("correction", "Correction", "Control+Shift+F")],
    selectedPresetId: "correction",
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
    (getHighlightedTextForOptionalContext as Mock).mockResolvedValue("");

    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    await askCall?.[1]();

    expect(showAskInputWindow).toHaveBeenCalledWith(
      { presetId: DEFAULT_ASK_PRESET_ID, context: "" },
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

  it("reads the selection via getHighlightedTextForOptionalContext, not getHighlightedText, so a stale clipboard on an empty selection never becomes the Ask context", async () => {
    // Regression guard for finding 07/f1: getHighlightedText's Cmd-C is a
    // no-op with nothing selected, so it silently returns whatever was
    // already on the clipboard (e.g. a password copied earlier). Ask must
    // read through the optional-context variant instead, which reports ""
    // for exactly that case (see src/utils.ts).
    (getHighlightedText as Mock).mockResolvedValue("stale clipboard: hunter2");
    (getHighlightedTextForOptionalContext as Mock).mockResolvedValue("");

    const calls = registerFrom(singleBuiltInProfile);
    const askCall = calls.find(([shortcut]) => shortcut === ASK_HOTKEY);
    await askCall?.[1]();

    expect(getHighlightedTextForOptionalContext).toHaveBeenCalled();
    expect(showAskInputWindow).toHaveBeenCalledWith(
      { presetId: DEFAULT_ASK_PRESET_ID, context: "" },
      expect.objectContaining({
        onSubmit: expect.any(Function),
        onCancel: expect.any(Function),
      }),
    );
  });

  it("still aborts a non-requiresInput preset with the noTextSelected notification when nothing is selected", async () => {
    (getHighlightedText as Mock).mockResolvedValue("");

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
