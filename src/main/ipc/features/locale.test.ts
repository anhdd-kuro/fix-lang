/**
 * @file locale.test.ts
 * @description IPC boundary tests for locale get/set handlers and window
 * broadcast/sync helpers. Electron and the persisted store are mocked so
 * only the handler wiring and validation are under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  broadcastLocale,
  registerLocaleHandlers,
  syncLocaleToWindow,
} from "./locale";

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(),
}));

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
  setLocale: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
  setLocale: localeStoreMocks.setLocale,
}));

type Handler = (event: unknown, raw: unknown) => unknown;

const buildWindow = (isDestroyed: boolean) => ({
  isDestroyed: () => isDestroyed,
  webContents: { send: vi.fn() },
});

const getHandler = (channel: string): Handler => {
  const call = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) {
    throw new Error(`no handler registered for channel "${channel}"`);
  }
  return call[1] as Handler;
};

describe("registerLocaleHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerLocaleHandlers();
  });

  it("get-locale returns the current stored locale", async () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    await expect(getHandler("get-locale")(undefined, undefined)).resolves.toEqual({
      locale: "ja",
    });
  });

  it("set-locale persists and broadcasts a valid locale", async () => {
    const window = buildWindow(false);
    electronMocks.getAllWindows.mockReturnValue([window]);

    await expect(getHandler("set-locale")(undefined, "ja")).resolves.toEqual({
      success: true,
    });

    expect(localeStoreMocks.setLocale).toHaveBeenCalledWith("ja");
    expect(window.webContents.send).toHaveBeenCalledWith("locale-changed", "ja");
  });

  it.each([["fr"], [""], [42], [null], [undefined], [{ locale: "ja" }]])(
    "set-locale rejects invalid input %j without persisting",
    async (raw) => {
      await expect(getHandler("set-locale")(undefined, raw)).resolves.toEqual({
        success: false,
        error: "Invalid locale",
      });

      expect(localeStoreMocks.setLocale).not.toHaveBeenCalled();
      expect(electronMocks.getAllWindows).not.toHaveBeenCalled();
    },
  );
});

describe("broadcastLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends locale-changed to every non-destroyed window and skips destroyed ones", () => {
    const destroyed = buildWindow(true);
    const alive = buildWindow(false);
    electronMocks.getAllWindows.mockReturnValue([destroyed, alive]);

    broadcastLocale("ja");

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(alive.webContents.send).toHaveBeenCalledWith("locale-changed", "ja");
  });
});

describe("syncLocaleToWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the current locale to a single non-destroyed window", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");
    const webContents = { isDestroyed: () => false, send: vi.fn() };

    syncLocaleToWindow(webContents as unknown as Electron.WebContents);

    expect(webContents.send).toHaveBeenCalledWith("locale-changed", "en");
  });

  it("does not send to a destroyed window", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");
    const webContents = { isDestroyed: () => true, send: vi.fn() };

    syncLocaleToWindow(webContents as unknown as Electron.WebContents);

    expect(webContents.send).not.toHaveBeenCalled();
  });
});
