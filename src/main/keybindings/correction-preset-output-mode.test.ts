/**
 * @file correction-preset-output-mode.test.ts
 * @description `CorrectionPreset.outputMode` is offered as a Select on EVERY
 * preset in Settings, not only on the `requiresInput` one — so the ordinary
 * (non-Ask) hotkey path has to honour it too. It originally read
 * `outputModeStore.getCorrectionOutputMode()` directly, which made the saved
 * choice inert for the six polish presets: the control was visible, writable,
 * persisted, and ignored.
 *
 * Drives the real registered hotkey handler with `deliverCorrectionOutput`
 * left unmocked, so what is asserted is the actual delivery (paste vs popup)
 * rather than an argument handed to a stub.
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
vi.mock("~/main/accessibility/activeApp", () => ({
  getActiveApp: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/features/correction/store/keybindingStore", () => ({
  keybindingStore: {
    getKeyBindings: vi.fn().mockReturnValue({
      promptGen: "Control+Shift+P",
      profileSwitch: "Control+Shift+S",
    }),
  },
}));
vi.mock("~/features/correction/store/outputModeStore", () => ({
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("paste") },
}));
vi.mock("../../utils", () => ({
  getHighlightedText: vi.fn().mockResolvedValue("some selected text"),
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
vi.mock("./utils", () => ({
  checkShortcut: vi.fn(),
  handleError: vi.fn(),
  withHotkeyThrottle: (_accelerator: string, handler: () => unknown) => handler,
}));
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
import { outputModeStore } from "~/features/correction/store/outputModeStore";
import { getProfileSetting } from "~/features/providers/store/apiStore";
import { registerCorrectionShortcut } from "./correction";
import { pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import { showCorrectionResultWindow } from "../webViewWindows/correctionResultWindow";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";
import type { CorrectionOutputMode } from "~/features/correction/shared/outputMode";
import type { PresetOutputMode } from "~/features/correction/shared/presetOutputMode";

const HOTKEY = "Control+Shift+F";

const fakeMainWindow = () =>
  ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow;

/**
 * Runs the ordinary (non-`requiresInput`) preset hotkey with a given
 * per-preset `outputMode` against a given global mode.
 */
const runPolishHotkey = async ({
  presetOutputMode,
  globalMode,
}: {
  presetOutputMode?: PresetOutputMode;
  globalMode: CorrectionOutputMode;
}) => {
  (outputModeStore.getCorrectionOutputMode as Mock).mockReturnValue(globalMode);
  (getProfileSetting as Mock).mockImplementation((key: string) =>
    key === "models"
      ? []
      : {
          presets: [
            {
              id: "correction-default",
              name: "Correction",
              hotkey: HOTKEY,
              systemPrompt: "Fix grammar.",
              model: "",
              isBuiltIn: true,
              ...(presetOutputMode ? { outputMode: presetOutputMode } : {}),
            },
          ],
          selectedPresetId: "correction-default",
        },
  );
  (fixGrammar as Mock).mockResolvedValue({
    correctedText: "some corrected text",
    promptTokens: 10,
    completionTokens: 5,
    model: "openai/gpt-4.1-mini",
    provider: "openai",
    resolvedModel: "openai/gpt-4.1-mini",
    presetId: "correction-default",
    presetName: "Correction",
  });

  registerCorrectionShortcut(fakeMainWindow());
  const [, handler] = (globalShortcut.register as Mock).mock.calls[0];
  await handler();
};

describe("ordinary preset hotkey honours CorrectionPreset.outputMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalShortcut.register as Mock).mockReturnValue(true);
  });

  it("delivers to the popup when the preset says 'popup' and the global mode is 'paste'", async () => {
    await runPolishHotkey({ presetOutputMode: "popup", globalMode: "paste" });

    expect(showCorrectionResultWindow).toHaveBeenCalledWith({
      presetName: "Correction",
      text: "some corrected text",
    });
    expect(pasteText).not.toHaveBeenCalled();
  });

  it("pastes when the preset says 'paste' and the global mode is 'popup'", async () => {
    await runPolishHotkey({ presetOutputMode: "paste", globalMode: "popup" });

    expect(pasteText).toHaveBeenCalledWith("some corrected text");
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
  });

  it("defers to the global mode when the preset says 'inherit'", async () => {
    await runPolishHotkey({ presetOutputMode: "inherit", globalMode: "popup" });

    expect(showCorrectionResultWindow).toHaveBeenCalledTimes(1);
    expect(pasteText).not.toHaveBeenCalled();
  });

  it("defers to the global mode when the preset carries no outputMode at all", async () => {
    await runPolishHotkey({ globalMode: "paste" });

    expect(pasteText).toHaveBeenCalledWith("some corrected text");
    expect(showCorrectionResultWindow).not.toHaveBeenCalled();
  });
});
