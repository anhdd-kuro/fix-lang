/**
 * @file askResultWindow.test.ts
 * @description Verifies the multi-instance Ask AI result popup: up to five
 * live windows keyed by id (not a module-level singleton like
 * `correctionResultWindow.ts`), a cascade offset per newly-opened window, a
 * payload for window id *k* reaching window *k* only, and — the one
 * deliberate divergence from `correctionResultWindow.ts` — a close that
 * DESTROYS the window instead of hiding it, since up to five live renderer
 * processes make hiding a leak. Electron is mocked exactly as
 * `correctionResultWindow.test.ts:44-58` does — this never boots a real
 * window.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const windowTitlesMocks = vi.hoisted(() => ({
  buildAskResultWindowTitle: vi.fn(() => "Ask AI result"),
}));

vi.mock("./windowTitles", () => ({
  buildAskResultWindowTitle: windowTitlesMocks.buildAskResultWindowTitle,
}));

vi.mock("./attachThemeSync", () => ({
  attachThemeSync: vi.fn(),
}));

let nextWindowId = 1;

class BrowserWindowMock {
  id = nextWindowId++;
  setTitle = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  isDestroyed = vi.fn(() => false);
  destroy = vi.fn();
  close = vi.fn();
  removeAllListeners = vi.fn();
  on = vi.fn();
  show = vi.fn();
  hide = vi.fn();
  focus = vi.fn();
  loadFile = vi.fn();
  setPosition = vi.fn();
  webContents = {
    send: vi.fn(),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getURL: vi.fn(() => ""),
  };
}

let createdWindows: BrowserWindowMock[] = [];

const electronMocks = vi.hoisted(() => ({
  ipcMainOn: vi.fn(),
  appOn: vi.fn(),
  fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: Object.assign(
    vi.fn().mockImplementation(function BrowserWindowCtor() {
      const win = new BrowserWindowMock();
      createdWindows.push(win);
      return win;
    }),
    { fromWebContents: electronMocks.fromWebContents },
  ),
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
  ipcMain: { on: electronMocks.ipcMainOn, handle: vi.fn() },
  app: { getAppPath: vi.fn(() => "/app"), on: electronMocks.appOn },
}));

const PAYLOAD_A = {
  presetName: "Ask AI",
  question: "What is a monad?",
  answer: "A monoid in the category of endofunctors.",
  markdown: true,
};
const PAYLOAD_B = {
  presetName: "Ask AI",
  question: "What is currying?",
  answer: "Partial application, chained.",
  markdown: true,
};

const loadModule = async () => {
  vi.resetModules();
  return import("./askResultWindow");
};

const getIpcHandler = (channel: string) => {
  const call = electronMocks.ipcMainOn.mock.calls.find(
    ([name]) => name === channel,
  );
  if (!call) throw new Error(`no ipcMain.on handler for "${channel}"`);
  return call[1] as (event: unknown) => void;
};

/** Simulates the renderer inside `win` announcing readiness. */
const fireReady = (win: BrowserWindowMock): void => {
  electronMocks.fromWebContents.mockReturnValue(win);
  getIpcHandler("ask-result-ready")({ sender: win.webContents });
};

describe("askResultWindow", () => {
  beforeEach(() => {
    createdWindows = [];
    nextWindowId = 1;
    vi.clearAllMocks();
  });

  it("delivers a payload for window k to window k only, once it reports ready", async () => {
    const { showAskResultWindow } = await loadModule();

    showAskResultWindow(PAYLOAD_A as never);
    showAskResultWindow(PAYLOAD_B as never);

    const [winA, winB] = createdWindows;
    fireReady(winA);

    expect(winA.webContents.send).toHaveBeenCalledWith(
      "ask-result-data",
      PAYLOAD_A,
    );
    expect(winB.webContents.send).not.toHaveBeenCalled();

    fireReady(winB);

    expect(winB.webContents.send).toHaveBeenCalledWith(
      "ask-result-data",
      PAYLOAD_B,
    );
    expect(winA.webContents.send).toHaveBeenCalledTimes(1);
  });

  it("gives each newly-opened window an increasing cascade offset", async () => {
    const { showAskResultWindow } = await loadModule();

    for (let i = 0; i < 5; i += 1) {
      showAskResultWindow(PAYLOAD_A as never);
    }

    const xs = createdWindows.map((win) => win.setPosition.mock.calls[0][0]);
    expect(xs).toEqual([100 + 16, 100 + 40, 100 + 64, 100 + 88, 100 + 112]);
  });

  it("reuses the lowest free cascade slot after a non-newest window closes, instead of colliding with a still-open window", async () => {
    const { showAskResultWindow } = await loadModule();

    showAskResultWindow(PAYLOAD_A as never);
    showAskResultWindow(PAYLOAD_A as never);
    showAskResultWindow(PAYLOAD_A as never);
    const [win1, win2, win3] = createdWindows;

    // Close only the first (oldest) of the three, leaving win2 and win3 live.
    const closedCall = win1.on.mock.calls.find(([name]) => name === "closed");
    closedCall?.[1]();

    showAskResultWindow(PAYLOAD_A as never);
    const win4 = createdWindows[3];

    // win2's offset (+40) and win3's offset (+64) are still occupied; the new
    // window must reclaim the freed +16 slot, not collide with win3.
    expect(win4.setPosition).toHaveBeenCalledWith(100 + 16, 100 + 16, false);
    expect(win2.setPosition.mock.calls[0]).toEqual([100 + 40, 100 + 40, false]);
    expect(win3.setPosition.mock.calls[0]).toEqual([100 + 64, 100 + 64, false]);
  });

  it("does not plateau at the same cascade offset once past the cap", async () => {
    const { showAskResultWindow } = await loadModule();

    for (let i = 0; i < 8; i += 1) {
      showAskResultWindow(PAYLOAD_A as never);
    }

    // The 6th, 7th, and 8th windows (opened after the cap started evicting)
    // must not all land on the same cascade offset.
    const last3 = createdWindows.slice(-3);
    const xs = last3.map((win) => win.setPosition.mock.calls[0][0]);
    expect(new Set(xs).size).toBe(3);
  });

  it("caps at 5: opening a 6th destroys the oldest window", async () => {
    const { showAskResultWindow } = await loadModule();

    for (let i = 0; i < 6; i += 1) {
      showAskResultWindow(PAYLOAD_A as never);
    }

    expect(createdWindows).toHaveLength(6);
    const oldest = createdWindows[0];
    expect(oldest.destroy).toHaveBeenCalledOnce();
    createdWindows.slice(1).forEach((win) => {
      expect(win.destroy).not.toHaveBeenCalled();
    });
  });

  it("closing an Ask result window DESTROYS it instead of hiding it", async () => {
    const { showAskResultWindow } = await loadModule();
    showAskResultWindow(PAYLOAD_A as never);
    const [win] = createdWindows;

    const closeCall = win.on.mock.calls.find(([name]) => name === "close");
    expect(closeCall).toBeUndefined();

    electronMocks.fromWebContents.mockReturnValue(win);
    getIpcHandler("close-ask-result-window")({ sender: win.webContents });

    expect(win.close).toHaveBeenCalledOnce();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("removes the window from tracking once it reports closed", async () => {
    const { showAskResultWindow } = await loadModule();
    showAskResultWindow(PAYLOAD_A as never);
    const [win] = createdWindows;

    const closedCall = win.on.mock.calls.find(([name]) => name === "closed");
    expect(closedCall).toBeDefined();
    closedCall?.[1]();

    // A window that already reported "closed" is gone from tracking, so a
    // late ready event for it must not throw or send anything.
    electronMocks.fromWebContents.mockReturnValue(win);
    expect(() =>
      getIpcHandler("ask-result-ready")({ sender: win.webContents }),
    ).not.toThrow();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("prevents index.html's static <title> from overriding the localized window title", async () => {
    const { showAskResultWindow } = await loadModule();
    showAskResultWindow(PAYLOAD_A as never);
    const [win] = createdWindows;

    const pageTitleUpdatedCall = win.on.mock.calls.find(
      ([eventName]) => eventName === "page-title-updated",
    );
    expect(pageTitleUpdatedCall).toBeDefined();

    const preventDefault = vi.fn();
    pageTitleUpdatedCall?.[1]({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("retitles every open window to the freshly-built locale title, skipping destroyed ones", async () => {
    const { showAskResultWindow, syncAskResultWindowLocale } = await loadModule();
    showAskResultWindow(PAYLOAD_A as never);
    showAskResultWindow(PAYLOAD_B as never);
    const [winA, winB] = createdWindows;
    winB.isDestroyed.mockReturnValue(true);
    windowTitlesMocks.buildAskResultWindowTitle.mockReturnValue("AIへの質問の結果");

    syncAskResultWindowLocale();

    expect(winA.setTitle).toHaveBeenCalledWith("AIへの質問の結果");
    expect(winB.setTitle).not.toHaveBeenCalled();
  });

  it("does nothing when syncing locale with no open windows", async () => {
    const { syncAskResultWindowLocale } = await loadModule();

    expect(() => syncAskResultWindowLocale()).not.toThrow();
  });
});
