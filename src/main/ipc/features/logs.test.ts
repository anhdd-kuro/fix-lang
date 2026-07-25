/**
 * @file logs.test.ts
 * @description IPC boundary test for the `logs:export` save-dialog copy.
 * `mainT` reads the locale on every call (see `~/main/i18n.ts`), so the
 * dialog title/filter must be resolved inside the handler at dialog-open
 * time, not baked in at module load. `~/stores/localeStore` is mocked so the
 * test can flip locales directly instead of touching `electron-store`; the
 * expected copy is derived through the real translator kernel
 * (`createTranslator`) so a catalog reword can't silently break this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshMainLocale } from "~/main/i18n";
import { createTranslator } from "~/shared/i18n/translate";
import { registerLogHandlers } from "./logs";

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(() => []),
  showSaveDialog: vi.fn(),
  getPath: vi.fn(() => "/tmp/documents"),
  writeText: vi.fn(),
}));

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

const logServiceMocks = vi.hoisted(() => ({
  enablePersistence: vi.fn(),
  formatAll: vi.fn(async () => ""),
  subscribe: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: electronMocks.getPath },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  clipboard: { writeText: electronMocks.writeText },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
  ipcMain: { handle: electronMocks.handle },
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

vi.mock("~/main/logging/logService", () => ({
  logService: logServiceMocks,
  logger: { info: vi.fn(), error: vi.fn() },
}));

const tEn = createTranslator("en");
const tJa = createTranslator("ja");

type Handler = (event: unknown, raw?: unknown) => unknown;

const getHandler = (channel: string): Handler => {
  const call = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) {
    throw new Error(`no handler registered for channel "${channel}"`);
  }
  return call[1] as Handler;
};

describe("logs:export dialog copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMainLocale();
    electronMocks.getAllWindows.mockReturnValue([]);
    // Cancel the dialog so the handler returns before touching the filesystem —
    // this test only cares about the strings passed to showSaveDialog.
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: true });
    registerLogHandlers();
  });

  it("resolves the English dialog title and filter name", async () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    await getHandler("logs:export")(undefined);

    expect(electronMocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: tEn("logs.export.dialogTitle"),
        filters: [{ name: tEn("logs.export.filterName"), extensions: ["txt"] }],
      }),
    );
  });

  it("resolves the Japanese dialog title and filter name, distinct from English", async () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    await getHandler("logs:export")(undefined);

    const enText = tEn("logs.export.dialogTitle");
    const jaText = tJa("logs.export.dialogTitle");
    expect(jaText).not.toBe(enText);

    expect(electronMocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: jaText,
        filters: [{ name: tJa("logs.export.filterName"), extensions: ["txt"] }],
      }),
    );
  });
});
