/**
 * @file confirmLargeSelection.test.ts
 * @description Covers the size-cap confirm dialog: it must use the awaited
 * `dialog.showMessageBox` (never the sync form that used to freeze the main
 * process behind stacked modals — see `~/main/index.ts` around the
 * accessibility-permission dialog comment), default/cancel both to Cancel,
 * and refuse to open a second modal while one is already pending.
 *
 * `~/main/i18n` transitively instantiates a real `electron-store` at module
 * scope, which throws without a real Electron `app` — mocking
 * `~/features/i18n/store/localeStore` directly (the `utils.test.ts` pattern)
 * avoids touching Electron or the filesystem while still exercising the
 * real translator/catalog.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmLargeSelection } from "./confirmLargeSelection";

const { showMessageBoxMock } = vi.hoisted(() => ({
  showMessageBoxMock: vi.fn(),
}));

vi.mock("electron", () => {
  const mockedExports = {
    dialog: {
      showMessageBox: showMessageBoxMock,
    },
  };
  return { ...mockedExports, default: mockedExports };
});

vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: vi.fn().mockReturnValue("en"),
}));

const deferredResponse = () => {
  let resolve!: (response: { response: number }) => void;
  const promise = new Promise<{ response: number }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("confirmLargeSelection", () => {
  beforeEach(() => {
    showMessageBoxMock.mockReset();
  });

  it("never references showMessageBoxSync in source, and the mocked dialog exposes no such method", () => {
    const source = readFileSync(path.join(__dirname, "confirmLargeSelection.ts"), "utf8");
    expect(source).not.toMatch(/showMessageBoxSync/);
    expect(
      (electron.dialog as { showMessageBoxSync?: unknown }).showMessageBoxSync,
    ).toBeUndefined();
  });

  it("calls the awaited dialog.showMessageBox with Cancel as both default and cancel", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });

    await confirmLargeSelection(25_000, 20_000);

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
    const options = showMessageBoxMock.mock.calls[0][0];
    expect(options.defaultId).toBe(options.cancelId);
    expect(options.buttons[options.cancelId]).toMatch(/cancel/i);
  });

  it("resolves true only when the response index is the Send button", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });
    expect(await confirmLargeSelection(25_000, 20_000)).toBe(false);

    const options = showMessageBoxMock.mock.calls[0][0];
    const sendIndex = options.buttons.findIndex((label: string) => /send/i.test(label));
    expect(sendIndex).toBeGreaterThan(-1);
    expect(sendIndex).not.toBe(options.cancelId);

    showMessageBoxMock.mockResolvedValue({ response: sendIndex });
    expect(await confirmLargeSelection(25_000, 20_000)).toBe(true);
  });

  it("resolves false for a second call while the first dialog is still open, without opening a second modal", async () => {
    const first = deferredResponse();
    showMessageBoxMock.mockReturnValueOnce(first.promise);

    const firstCall = confirmLargeSelection(25_000, 20_000);
    const secondCall = confirmLargeSelection(25_000, 20_000);

    await expect(secondCall).resolves.toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

    first.resolve({ response: 0 });
    await expect(firstCall).resolves.toBe(false);
  });

  it("allows a new dialog once the previous one has resolved", async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 });
    await confirmLargeSelection(25_000, 20_000);

    showMessageBoxMock.mockResolvedValueOnce({ response: 0 });
    await confirmLargeSelection(25_000, 20_000);

    expect(showMessageBoxMock).toHaveBeenCalledTimes(2);
  });
});
