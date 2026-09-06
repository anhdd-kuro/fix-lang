/**
 * @file promptGenWindow.test.ts
 * @description Verifies `syncPromptGenWindowLocale` retitles an already-open
 * PromptGen window (Item 3, i18n gap-closing wave). `title` is only read once
 * at `BrowserWindow` construction and this window is a creation-cached
 * singleton, so a locale switch after the window opens must explicitly call
 * `setTitle`. Electron and the asset/theme-sync imports are mocked — this
 * never boots a real window.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPromptGenWindow,
  destroyPromptGenWindow,
  syncPromptGenWindowLocale,
} from "./promptGenWindow";

const windowTitlesMocks = vi.hoisted(() => ({
  buildPromptGenWindowTitle: vi.fn(() => "Generated Prompts"),
}));

vi.mock("./windowTitles", () => ({
  buildPromptGenWindowTitle: windowTitlesMocks.buildPromptGenWindowTitle,
}));

vi.mock("./attachThemeSync", () => ({
  attachThemeSync: vi.fn(),
}));

vi.mock("../../../resources/icon.ico?asset", () => ({ default: "icon.ico" }));

class BrowserWindowMock {
  setTitle = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  isDestroyed = vi.fn(() => false);
  close = vi.fn();
  on = vi.fn();
  hide = vi.fn();
  show = vi.fn();
  loadFile = vi.fn();
  webContents = {
    send: vi.fn(),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getURL: vi.fn(() => ""),
  };
}

let lastWindow: BrowserWindowMock | null = null;

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation(function BrowserWindowCtor() {
    lastWindow = new BrowserWindowMock();
    return lastWindow;
  }),
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ bounds: { width: 1920, height: 1080 } })),
  },
  ipcMain: { on: vi.fn() },
  app: { getAppPath: vi.fn(() => "/app"), on: vi.fn() },
}));

describe("syncPromptGenWindowLocale", () => {
  beforeEach(() => {
    destroyPromptGenWindow();
    lastWindow = null;
    vi.clearAllMocks();
  });

  it("does nothing when no window has been created", () => {
    expect(() => syncPromptGenWindowLocale()).not.toThrow();
  });

  it("retitles an already-open window to the freshly-built locale title", () => {
    createPromptGenWindow();
    windowTitlesMocks.buildPromptGenWindowTitle.mockReturnValue("生成されたプロンプト");

    syncPromptGenWindowLocale();

    expect(lastWindow?.setTitle).toHaveBeenCalledWith("生成されたプロンプト");
  });

  it("does not retitle a destroyed window", () => {
    createPromptGenWindow();
    lastWindow?.isDestroyed.mockReturnValue(true);

    syncPromptGenWindowLocale();

    expect(lastWindow?.setTitle).not.toHaveBeenCalled();
  });
});
