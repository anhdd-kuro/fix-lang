/**
 * @file confirmSelectionGuard.test.ts
 * @description Covers the selection-guard confirm dialog: it must use the awaited
 * `dialog.showMessageBox` (never the sync form that used to freeze the main
 * process behind stacked modals — see `~/main/index.ts` around the
 * accessibility-permission dialog comment), default/cancel both to Cancel,
 * and refuse to open a second modal while one is already pending — including
 * across REASONS, since the age guard and the size guard can both fire on one
 * press and two stacked modals per hotkey is how a consent surface becomes
 * something people click through without reading.
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
import { confirmSelectionGuard } from "./confirmSelectionGuard";

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

const LARGE_SELECTION = {
  kind: "confirm",
  reason: "large-selection",
  chars: 25_000,
  limit: 20_000,
} as const;

const STALE_CLIPBOARD = {
  kind: "confirm",
  reason: "stale-clipboard",
  ageMs: 600_000,
  limitMs: 5_000,
} as const;

const UNKNOWN_AGE = {
  kind: "confirm",
  reason: "unknown-clipboard-age",
  ageMs: 0,
  limitMs: 5_000,
} as const;

const deferredResponse = () => {
  let resolve!: (response: { response: number }) => void;
  const promise = new Promise<{ response: number }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("confirmSelectionGuard", () => {
  beforeEach(() => {
    showMessageBoxMock.mockReset();
  });

  it("never references showMessageBoxSync in source, and the mocked dialog exposes no such method", () => {
    const source = readFileSync(path.join(__dirname, "confirmSelectionGuard.ts"), "utf8");
    expect(source).not.toMatch(/showMessageBoxSync/);
    expect(
      (electron.dialog as { showMessageBoxSync?: unknown }).showMessageBoxSync,
    ).toBeUndefined();
  });

  it("calls the awaited dialog.showMessageBox with Cancel as both default and cancel", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });

    await confirmSelectionGuard(LARGE_SELECTION);

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
    const options = showMessageBoxMock.mock.calls[0][0];
    expect(options.defaultId).toBe(options.cancelId);
    expect(options.buttons[options.cancelId]).toMatch(/cancel/i);
  });

  it("resolves true only when the response index is the Send button", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });
    expect(await confirmSelectionGuard(LARGE_SELECTION)).toBe(false);

    const options = showMessageBoxMock.mock.calls[0][0];
    const sendIndex = options.buttons.findIndex((label: string) => /send/i.test(label));
    expect(sendIndex).toBeGreaterThan(-1);
    expect(sendIndex).not.toBe(options.cancelId);

    showMessageBoxMock.mockResolvedValue({ response: sendIndex });
    expect(await confirmSelectionGuard(LARGE_SELECTION)).toBe(true);
  });

  it("resolves false for a second call while the first dialog is still open, without opening a second modal", async () => {
    const first = deferredResponse();
    showMessageBoxMock.mockReturnValueOnce(first.promise);

    const firstCall = confirmSelectionGuard(LARGE_SELECTION);
    const secondCall = confirmSelectionGuard(LARGE_SELECTION);

    await expect(secondCall).resolves.toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

    first.resolve({ response: 0 });
    await expect(firstCall).resolves.toBe(false);
  });

  it("allows a new dialog once the previous one has resolved", async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 });
    await confirmSelectionGuard(LARGE_SELECTION);

    showMessageBoxMock.mockResolvedValueOnce({ response: 0 });
    await confirmSelectionGuard(LARGE_SELECTION);

    expect(showMessageBoxMock).toHaveBeenCalledTimes(2);
  });

  it("holds one dialog at a time ACROSS reasons, not one per reason", async () => {
    const first = deferredResponse();
    showMessageBoxMock.mockReturnValueOnce(first.promise);

    const staleCall = confirmSelectionGuard(STALE_CLIPBOARD);
    await expect(confirmSelectionGuard(LARGE_SELECTION)).resolves.toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

    first.resolve({ response: 0 });
    await expect(staleCall).resolves.toBe(false);
  });

  /**
   * The two age reasons say DIFFERENT things, and the difference is the whole
   * point: one is a measurement ("this has been here 10 minutes"), the other
   * is the absence of one ("this predates FixLang, so there is no telling").
   * A user deciding whether to send a password needs to know which they are
   * being shown, so a shared string here would be a real regression.
   */
  it("gives each reason its own title and message", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });

    await confirmSelectionGuard(LARGE_SELECTION);
    await confirmSelectionGuard(STALE_CLIPBOARD);
    await confirmSelectionGuard(UNKNOWN_AGE);

    const [large, stale, unknown] = showMessageBoxMock.mock.calls.map(([options]) => options);
    const titles = [large.title, stale.title, unknown.title];
    expect(new Set(titles).size).toBe(3);
    const messages = [large.message, stale.message, unknown.message];
    expect(new Set(messages).size).toBe(3);

    // Real catalog copy, so this proves the age actually reaches the string
    // rather than an unsubstituted `{seconds}` placeholder shipping to a user.
    expect(stale.message).toContain("600");
    expect(stale.message).not.toContain("{");
    expect(unknown.message).not.toContain("{");
  });
});
