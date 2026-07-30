/**
 * @file askFlow.test.ts
 * @description Exercises `runAskFlow` end to end at the seam the hotkey
 * branch hands off to: spinner -> fixGrammar -> deliverCorrectionOutput ->
 * history/cost. Only the true I/O boundaries (electron, the AI request, the
 * result window, history sync, logging, the locale store) are mocked;
 * `composeAskMessage`, `resolvePresetOutputMode`, and `deliverCorrectionOutput`
 * stay real so the composed message and mode resolution are genuinely
 * verified, not just assumed.
 */
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
    getProfileSetting: vi.fn().mockReturnValue(undefined),
    updateProfileSetting: vi.fn(),
    getDefaultModelId: vi.fn().mockReturnValue(""),
    apiStore: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
  };
});
vi.mock("../../utils", () => ({
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
vi.mock("../webViewWindows/askResultWindow", () => ({
  showAskResultWindow: vi.fn(),
}));
vi.mock("./utils", () => ({ handleError: vi.fn() }));
vi.mock("~/features/correction/store/outputModeStore", () => ({
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("paste") },
}));
vi.mock("~/features/i18n/store/localeStore", () => ({ getLocale: vi.fn().mockReturnValue("en") }));
// `ai.request/shared.ts` (imported for `getCachedModels`/`isLocalModelId`)
// pulls in `notifications/error.ts` -> `webViewWindows/errorPopupWindow.ts`,
// which imports `overlay.html?asset` — unparseable as JS under vitest. Stub
// that leaf, same as `correction-preset-hotkeys.test.ts`.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
import { outputModeStore } from "~/features/correction/store/outputModeStore";
import { syncHistory } from "~/features/history/main/history";
import { getLocale } from "~/features/i18n/store/localeStore";
import { runAskFlow } from "./askFlow";
import { handleError } from "./utils";
import { pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import { logger } from "../logging/logService";
import { hideOverlaySpinner, showOverlaySpinner } from "../webViewWindows";
import { showAskResultWindow } from "../webViewWindows/askResultWindow";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";
import type { CorrectionPreset } from "~/features/providers/store/apiStore";

const basePreset: CorrectionPreset = {
  id: "ask",
  name: "Ask AI",
  hotkey: "Control+Shift+A",
  systemPrompt: "Ask AI system prompt.",
  model: "",
  isBuiltIn: true,
  requiresInput: true,
  outputMode: "popup",
  markdownOutput: true,
};

const fakeMainWindow = () =>
  ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow;

const askSessionJson = JSON.stringify({
  systemPrompt: "Ask AI system prompt.",
  userPrompt: "Question",
  reasoningEffort: "medium",
  responses: ["The answer."],
  usage: { promptTokens: 12, completionTokens: 6 },
});

const fixGrammarResult = {
  correctedText: "The answer.",
  promptTokens: 12,
  completionTokens: 6,
  model: "openai/gpt-4.1-mini",
  provider: "openai" as const,
  resolvedModel: "openai/gpt-4.1-mini",
  presetId: "ask",
  presetName: "Ask AI",
  sessionJson: askSessionJson,
};

const syncedEntry = () => {
  const call = (syncHistory as Mock).mock.calls.at(0);
  return call?.[0]?.entry as { sessionJson?: string } | undefined;
};

/** Mirrors the History row's own gate — `HistoryEntryItem.tsx:54`. */
const showsDetailsControl = (sessionJson: unknown): boolean =>
  typeof sessionJson === "string" && sessionJson.length > 0;

describe("runAskFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fixGrammar as Mock).mockResolvedValue(fixGrammarResult);
    (getLocale as Mock).mockReturnValue("en");
    (outputModeStore.getCorrectionOutputMode as Mock).mockReturnValue("paste");
  });

  it("is a no-op when the question is empty/whitespace-only — never shows the spinner", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "some selected text",
      question: "   ",
      mainWindow: fakeMainWindow(),
    });

    expect(showOverlaySpinner).not.toHaveBeenCalled();
    expect(fixGrammar).not.toHaveBeenCalled();
  });

  it("sends the composed question+context message with an appended app-locale directive, and never passes a context arg to fixGrammar", async () => {
    (getLocale as Mock).mockReturnValue("ja");

    await runAskFlow({
      preset: basePreset,
      context: "the selected passage",
      question: "What does this mean?",
      mainWindow: fakeMainWindow(),
    });

    expect(getLocale).toHaveBeenCalled();
    expect(fixGrammar).toHaveBeenCalledWith(
      [
        "What does this mean?",
        "",
        "----- context -----",
        "the selected passage",
        "----- end context -----",
        "",
        "App locale: ja",
      ].join("\n"),
      "ask",
    );
  });

  it("sends the bare question (no context block) with the locale directive when nothing was selected", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "",
      question: "Just a question",
      mainWindow: fakeMainWindow(),
    });

    expect(fixGrammar).toHaveBeenCalledWith(
      "Just a question\n\nApp locale: en",
      "ask",
    );
  });

  it("shows the spinner before the request and hides it after a successful popup delivery", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(showOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
  });

  it("resolves popup mode via resolvePresetOutputMode and delivers through showAskResultWindow with question/answer/markdown", async () => {
    (outputModeStore.getCorrectionOutputMode as Mock).mockReturnValue("paste");

    await runAskFlow({
      preset: basePreset, // outputMode: "popup" overrides the global "paste"
      context: "",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(showAskResultWindow).toHaveBeenCalledWith({
      presetName: "Ask AI",
      question: "Question",
      answer: "The answer.",
      markdown: true,
      input: "",
    });
  });

  it("forwards the carried selection to the result window as `input`", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "the selected passage",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(showAskResultWindow).toHaveBeenCalledWith(
      expect.objectContaining({ input: "the selected passage" }),
    );
  });

  it("falls back to the global output mode ('paste') when the preset's outputMode is 'inherit'", async () => {
    (outputModeStore.getCorrectionOutputMode as Mock).mockReturnValue("paste");

    await runAskFlow({
      preset: { ...basePreset, outputMode: "inherit" },
      context: "",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(showAskResultWindow).not.toHaveBeenCalled();
    expect(pasteText).toHaveBeenCalledWith("The answer.");
  });

  it("records history and cost only when mainWindow is live, using the sent message as `original`", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(syncHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({
          original: "Question\n\nApp locale: en",
          corrected: "The answer.",
        }),
        type: "add",
        featureId: "corrections",
      }),
    );
  });

  it("stores the raw completion snapshot as sessionJson, like the Transform hotkey path", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(syncHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({ sessionJson: askSessionJson }),
      }),
    );
    expect(showsDetailsControl(syncedEntry()?.sessionJson)).toBe(true);
  });

  it("leaves sessionJson undefined (SQL NULL) when the result carries no session, hiding the details control", async () => {
    const { sessionJson: _omitted, ...withoutSession } = fixGrammarResult;
    (fixGrammar as Mock).mockResolvedValue(withoutSession);

    await runAskFlow({
      preset: basePreset,
      context: "",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(syncedEntry()).toBeDefined();
    expect(syncedEntry()?.sessionJson).toBeUndefined();
    expect(showsDetailsControl(syncedEntry()?.sessionJson)).toBe(false);
  });

  it("skips history sync when mainWindow is null", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "",
      question: "Question",
      mainWindow: null,
    });

    expect(syncHistory).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
  });

  it("hides the spinner and routes to handleError when fixGrammar rejects", async () => {
    const failure = new Error("network down");
    (fixGrammar as Mock).mockRejectedValue(failure);

    await runAskFlow({
      preset: basePreset,
      context: "",
      question: "Question",
      mainWindow: fakeMainWindow(),
    });

    expect(hideOverlaySpinner).toHaveBeenCalledTimes(1);
    expect(handleError).toHaveBeenCalledWith(failure);
    expect(syncHistory).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "correction.hotkey",
      "Ask failed",
      expect.objectContaining({ presetId: "ask" }),
    );
  });
});
