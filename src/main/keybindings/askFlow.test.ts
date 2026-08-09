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
// The secret gate itself (`runSecretGate`, `scanForSecrets`) stays REAL — a
// mocked gate would let a call site that re-derived Ask's mask-degrades-to-
// confirm policy pass.
vi.mock("~/features/secretGuard/store/secretGuardStore", () => ({
  secretGuardStore: { getSecretGuardSettings: vi.fn() },
}));
vi.mock("~/main/notifications/secretGuardDialog", () => ({
  confirmSecretSend: vi.fn(),
}));
// Kept REAL (wrapped, not replaced) so every other test's `latencyFinishCalls`
// assertion still observes genuine `finish()` behaviour — only wrapped in a
// spy so the ordering test below can see WHEN the timer starts, not merely
// whether it eventually finishes.
vi.mock("../logging/latencyTimer", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.importActual returns unknown module shape
  const real = await importOriginal<any>();
  return { ...real, startLatencyTimer: vi.fn(real.startLatencyTimer) };
});
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
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";
import { confirmSecretSend } from "~/main/notifications/secretGuardDialog";
import { runAskFlow } from "./askFlow";
import { handleError } from "./utils";
import { pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import { startLatencyTimer } from "../logging/latencyTimer";
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

/** A credential shaped exactly like the `openai-key` rule's pattern. */
const OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwx";

const setSecretGuardMode = (mode: "off" | "confirm" | "mask"): void => {
  (secretGuardStore.getSecretGuardSettings as Mock).mockReturnValue({
    mode,
    highEntropyRule: false,
  });
};

/** Every `logger.info` line the latency timer emitted, in order. */
const latencyFinishCalls = () =>
  (logger.info as Mock).mock.calls.filter(([scope]) => scope === "correction.latency");

describe("runAskFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fixGrammar as Mock).mockResolvedValue(fixGrammarResult);
    (getLocale as Mock).mockReturnValue("en");
    (outputModeStore.getCorrectionOutputMode as Mock).mockReturnValue("paste");
    setSecretGuardMode("confirm");
    (confirmSecretSend as Mock).mockResolvedValue(true);
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

describe("runAskFlow secret guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fixGrammar as Mock).mockResolvedValue(fixGrammarResult);
    (getLocale as Mock).mockReturnValue("en");
    (outputModeStore.getCorrectionOutputMode as Mock).mockReturnValue("paste");
    setSecretGuardMode("confirm");
    (confirmSecretSend as Mock).mockResolvedValue(true);
  });

  it("scans the COMPOSED message, so a secret in the typed QUESTION is caught", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "",
      question: `Is ${OPENAI_KEY} still valid?`,
      mainWindow: fakeMainWindow(),
    });

    // Nothing was selected: scanning only the selection would miss this
    // entirely, and a key is as likely typed as selected.
    expect(confirmSecretSend).toHaveBeenCalledTimes(1);
  });

  it("also catches a secret carried in only as selection context", async () => {
    await runAskFlow({
      preset: basePreset,
      context: `export OPENAI_API_KEY=${OPENAI_KEY}`,
      question: "What does this do?",
      mainWindow: fakeMainWindow(),
    });

    expect(confirmSecretSend).toHaveBeenCalledTimes(1);
  });

  it("gates BEFORE the latency timer starts: a decline emits no latency line, never shows the spinner, and never starts the timer at all", async () => {
    (confirmSecretSend as Mock).mockResolvedValue(false);

    await runAskFlow({
      preset: basePreset,
      context: "",
      question: `Is ${OPENAI_KEY} still valid?`,
      mainWindow: fakeMainWindow(),
    });

    expect(fixGrammar).not.toHaveBeenCalled();
    expect(syncHistory).not.toHaveBeenCalled();
    expect(showAskResultWindow).not.toHaveBeenCalled();
    expect(pasteText).not.toHaveBeenCalled();
    // Cancel is a decision, not an error.
    expect(handleError).not.toHaveBeenCalled();
    // `latencyFinishCalls` is blind to WHERE the gate sits: the declined
    // branch returns before `finish()` regardless of ordering, so an
    // assertion on it alone cannot tell "the timer never started" apart from
    // "the timer started and leaked". `startLatencyTimer` itself is the
    // thing that must never run — a mutation moving the gate to AFTER it
    // would still leave this at zero.
    expect(latencyFinishCalls()).toHaveLength(0);
    expect(startLatencyTimer).not.toHaveBeenCalled();
    expect(showOverlaySpinner).not.toHaveBeenCalled();
    expect(hideOverlaySpinner).not.toHaveBeenCalled();
  });

  it("starts the latency timer only after the gate has resolved, never before", async () => {
    // Neither mock's implementation is overridden here — `startLatencyTimer`
    // keeps the real delegate `vi.mock` wrapped it with above, so delivery,
    // history and the "delivered" finish still run through a genuine timer.
    // Only the SHARED call order is read.
    (confirmSecretSend as Mock).mockResolvedValue(true);

    await runAskFlow({
      preset: basePreset,
      context: "",
      question: `Is ${OPENAI_KEY} still valid?`,
      mainWindow: fakeMainWindow(),
    });

    const gateCallOrder = (confirmSecretSend as Mock).mock.invocationCallOrder[0];
    const timerCallOrder = (startLatencyTimer as Mock).mock.invocationCallOrder[0];
    expect(gateCallOrder).toBeDefined();
    expect(timerCallOrder).toBeDefined();
    // The whole point of the ordering: the gate resolves BEFORE the clock
    // starts, so a decline never leaves a started-but-unfinished timer behind
    // (see the test above). A mutation that swaps the two statements would
    // still pass every other test in this file — this is the one that would
    // catch it.
    expect(gateCallOrder).toBeLessThan(timerCallOrder);
  });

  it("shows no spinner while the dialog is open, even on the Send-anyway path", async () => {
    let spinnerShownDuringDialog = -1;
    (confirmSecretSend as Mock).mockImplementation(async () => {
      spinnerShownDuringDialog = (showOverlaySpinner as Mock).mock.calls.length;
      return true;
    });

    await runAskFlow({
      preset: basePreset,
      context: "",
      question: `Is ${OPENAI_KEY} still valid?`,
      mainWindow: fakeMainWindow(),
    });

    expect(spinnerShownDuringDialog).toBe(0);
    expect(showOverlaySpinner).toHaveBeenCalledTimes(1);
  });

  it("sends the full composed message after Send anyway, with exactly one delivered latency finish", async () => {
    const question = `Is ${OPENAI_KEY} still valid?`;

    await runAskFlow({
      preset: basePreset,
      context: "",
      question,
      mainWindow: fakeMainWindow(),
    });

    expect(fixGrammar).toHaveBeenCalledWith(`${question}\n\nApp locale: en`, "ask");
    const finishes = latencyFinishCalls();
    expect(finishes).toHaveLength(1);
    expect(finishes[0][2]).toMatchObject({ outcome: "delivered" });
  });

  it("opens no dialog when nothing is detected", async () => {
    await runAskFlow({
      preset: basePreset,
      context: "the selected passage",
      question: "What does this mean?",
      mainWindow: fakeMainWindow(),
    });

    expect(confirmSecretSend).not.toHaveBeenCalled();
    expect(fixGrammar).toHaveBeenCalledTimes(1);
  });

  it("opens no dialog when the guard is off", async () => {
    setSecretGuardMode("off");

    await runAskFlow({
      preset: basePreset,
      context: "",
      question: `Is ${OPENAI_KEY} still valid?`,
      mainWindow: fakeMainWindow(),
    });

    expect(confirmSecretSend).not.toHaveBeenCalled();
    expect(fixGrammar).toHaveBeenCalledTimes(1);
  });

  it("routes a throwing gate to handleError instead of leaving an unhandled rejection", async () => {
    // The only caller is `void runAskFlow(...)` in correction.ts, so a throw
    // out of the gate would surface nowhere at all: no toast, no log line, and
    // the user's question already gone with the input window. It fails closed
    // (nothing is sent), but it must not fail SILENTLY.
    const failure = new Error("secret guard store unreadable");
    (secretGuardStore.getSecretGuardSettings as Mock).mockImplementation(() => {
      throw failure;
    });

    await expect(
      runAskFlow({
        preset: basePreset,
        context: "",
        question: "Question",
        mainWindow: fakeMainWindow(),
      }),
    ).resolves.toBeUndefined();

    expect(fixGrammar).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledWith(failure);
    // No timer had started, so no latency line may be emitted either.
    expect(latencyFinishCalls()).toHaveLength(0);
  });

  it("degrades mask mode to a confirm and sends the message UNMASKED", async () => {
    setSecretGuardMode("mask");
    const question = `Is ${OPENAI_KEY} still valid?`;

    await runAskFlow({
      preset: basePreset,
      context: "",
      question,
      mainWindow: fakeMainWindow(),
    });

    // A free-form answer rarely echoes placeholders back, so a restore would
    // fail on most requests and permanently divert Ask to the popup.
    expect(confirmSecretSend).toHaveBeenCalledTimes(1);
    expect(fixGrammar).toHaveBeenCalledWith(`${question}\n\nApp locale: en`, "ask");
    const [sent] = (fixGrammar as Mock).mock.calls[0];
    expect(sent).not.toMatch(/FIXLANG_SECRET_/);
    expect(syncHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({ original: `${question}\n\nApp locale: en` }),
      }),
    );
  });
});
