/**
 * @file correction-cost-snapshot.test.ts
 * @description One profile's cache holds every provider's models, so a cloud id
 * can collide with a pulled Ollama model of the same name and get priced at $0.
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
  app: { getPath: vi.fn().mockReturnValue("/tmp"), getLocale: vi.fn().mockReturnValue("en-US") },
}));
vi.mock("~/stores/apiStore", async (importOriginal) => {
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
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: {
    getKeyBindings: vi
      .fn()
      .mockReturnValue({ promptGen: "Control+Shift+P", profileSwitch: "Control+Shift+S" }),
  },
}));
vi.mock("~/stores/outputModeStore", () => ({
  outputModeStore: { getCorrectionOutputMode: vi.fn().mockReturnValue("popup") },
}));
vi.mock("../../utils", () => ({
  getHighlightedTextWithActiveApp: vi
    .fn()
    .mockResolvedValue({ text: "some selected text", activeApp: null }),
  pasteText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ai.request", () => ({ fixGrammar: vi.fn() }));
vi.mock("../ipc/features/history", () => ({ syncHistory: vi.fn() }));
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
vi.mock("../webViewWindows/askInputWindow", () => ({ showAskInputWindow: vi.fn() }));
vi.mock("./askFlow", () => ({ runAskFlow: vi.fn() }));
vi.mock("./utils", () => ({
  checkShortcut: vi.fn(),
  handleError: vi.fn(),
  // Passthrough: this suite exercises cost snapshot wiring, not throttle.
  withHotkeyThrottle: (_accelerator: string, handler: () => unknown) => handler,
}));
// `notifications/error` reaches `overlay.html?asset`, which vite cannot parse
// as JS under vitest. Stub that leaf so `LocalizedError` stays real.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({ showErrorPopup: vi.fn() }));
import { getProfileSetting } from "~/stores/apiStore";
import { fixGrammar } from "../ai.request";
import { registerCorrectionShortcut } from "./correction";
import { syncHistory } from "../ipc/features/history";
import type { BrowserWindow } from "electron";
import type { Mock } from "vitest";
import type { Model, ProviderId } from "~/stores/apiStore";

const HOTKEY = "Control+Shift+F";

/**
 * The same raw id is reachable through two providers at once. This collision is
 * the whole point of the fixture: drop it and the test passes against the bug.
 */
const COLLIDING_RAW_ID = "google/gemma-2-9b-it";

const PRICING = {
  prompt: "0.000001",
  completion: "0.000002",
  image: "0",
  request: "0",
  input_cache_read: "0",
  input_cache_write: "0",
  web_search: "0",
  internal_reasoning: "0",
};

const CACHED_MODELS: Model[] = [
  {
    id: COLLIDING_RAW_ID,
    name: "Gemma 2 9B (pulled locally)",
    created: 0,
    provider: "ollama",
    local: { path: "/models/gemma" },
  },
  {
    id: COLLIDING_RAW_ID,
    name: "Gemma 2 9B",
    created: 0,
    provider: "openrouter",
    pricing: PRICING,
  },
];

const CORRECTION_SETTINGS = {
  presets: [
    {
      id: "correction-default",
      name: "Correction",
      hotkey: HOTKEY,
      systemPrompt: "Fix grammar.",
      model: "",
      isBuiltIn: true,
    },
  ],
  selectedPresetId: "correction-default",
};

const fakeMainWindow = () =>
  ({
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow;

const runHotkey = async (provider: ProviderId | undefined) => {
  (getProfileSetting as Mock).mockImplementation((key: string) =>
    key === "models" ? CACHED_MODELS : CORRECTION_SETTINGS,
  );
  (fixGrammar as Mock).mockResolvedValue({
    correctedText: "some corrected text",
    promptTokens: 1000,
    completionTokens: 500,
    model: COLLIDING_RAW_ID,
    provider,
    resolvedModel: COLLIDING_RAW_ID,
    presetId: "correction-default",
    presetName: "Correction",
  });

  registerCorrectionShortcut(fakeMainWindow());

  const [, handler] = (globalShortcut.register as Mock).mock.calls[0];
  await handler();

  return (syncHistory as Mock).mock.calls[0][0].entry;
};

describe("correction hotkey cost snapshot — provider decides local, not the raw id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalShortcut.register as Mock).mockReturnValue(true);
  });

  it("prices a cloud model whose raw id collides with a cached Ollama model", async () => {
    const entry = await runHotkey("openrouter");

    expect(entry.costStatus).toBe("ok");
    expect(entry.estimatedCostUsd).toBeCloseTo(1000 * 1e-6 + 500 * 2e-6, 12);
    expect(entry.pricePrompt).toBe(PRICING.prompt);
  });

  it("still prices an Ollama result as local", async () => {
    const entry = await runHotkey("ollama");

    expect(entry.costStatus).toBe("zero");
    expect(entry.estimatedCostUsd).toBe(0);
  });

  it("falls back to the cache scan when the result names no provider", async () => {
    const entry = await runHotkey(undefined);

    expect(entry.costStatus).toBe("zero");
    expect(entry.estimatedCostUsd).toBe(0);
  });
});
