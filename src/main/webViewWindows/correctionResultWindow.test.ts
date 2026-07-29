/**
 * @file correctionResultWindow.test.ts
 * @description Verifies `syncCorrectionResultWindowLocale` retitles an
 * already-open correction-result window (Item 3, i18n gap-closing wave).
 * `title` is only read once at `BrowserWindow` construction and this window
 * is a creation-cached singleton, so a locale switch after the window opens
 * must explicitly call `setTitle`. Electron and the theme-sync import are
 * mocked — this never boots a real window.
 *
 * The module keeps its `resultWindow` singleton in closure state with no
 * reset export, so each test re-imports the module fresh via
 * `vi.resetModules()` to avoid one test's window leaking into the next.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const windowTitlesMocks = vi.hoisted(() => ({
  buildCorrectionResultWindowTitle: vi.fn(() => "FixLang result"),
}));

vi.mock("./windowTitles", () => ({
  buildCorrectionResultWindowTitle: windowTitlesMocks.buildCorrectionResultWindowTitle,
}));

vi.mock("./attachThemeSync", () => ({
  attachThemeSync: vi.fn(),
}));

class BrowserWindowMock {
  setTitle = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  isDestroyed = vi.fn(() => false);
  destroy = vi.fn();
  removeAllListeners = vi.fn();
  on = vi.fn();
  show = vi.fn();
  hide = vi.fn();
  focus = vi.fn();
  loadFile = vi.fn();
  setPosition = vi.fn();
  webContents = { send: vi.fn(), on: vi.fn() };
}

let lastWindow: BrowserWindowMock | null = null;

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation(function BrowserWindowCtor() {
    lastWindow = new BrowserWindowMock();
    return lastWindow;
  }),
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getAppPath: vi.fn(() => "/app"), on: vi.fn() },
}));

const PAYLOAD = {
  original: "hello",
  corrected: "Hello.",
  model: "gpt",
};

const loadModule = async () => {
  vi.resetModules();
  return import("./correctionResultWindow");
};

describe("syncCorrectionResultWindowLocale", () => {
  beforeEach(() => {
    lastWindow = null;
    vi.clearAllMocks();
  });

  it("does nothing when no window has been created", async () => {
    const { syncCorrectionResultWindowLocale } = await loadModule();

    expect(() => syncCorrectionResultWindowLocale()).not.toThrow();
  });

  it("retitles an already-open window to the freshly-built locale title", async () => {
    const { showCorrectionResultWindow, syncCorrectionResultWindowLocale } =
      await loadModule();
    showCorrectionResultWindow(PAYLOAD as never);
    windowTitlesMocks.buildCorrectionResultWindowTitle.mockReturnValue("FixLangの結果");

    syncCorrectionResultWindowLocale();

    expect(lastWindow?.setTitle).toHaveBeenCalledWith("FixLangの結果");
  });

  it("does not retitle a destroyed window", async () => {
    const { showCorrectionResultWindow, syncCorrectionResultWindowLocale } =
      await loadModule();
    showCorrectionResultWindow(PAYLOAD as never);
    lastWindow?.isDestroyed.mockReturnValue(true);

    syncCorrectionResultWindowLocale();

    expect(lastWindow?.setTitle).not.toHaveBeenCalled();
  });

  it("prevents index.html's static <title> from overriding the localized window title", async () => {
    const { showCorrectionResultWindow } = await loadModule();
    showCorrectionResultWindow(PAYLOAD as never);

    const pageTitleUpdatedCall = lastWindow?.on.mock.calls.find(
      ([eventName]) => eventName === "page-title-updated",
    );
    expect(pageTitleUpdatedCall).toBeDefined();

    const preventDefault = vi.fn();
    pageTitleUpdatedCall?.[1]({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
