/**
 * @file settings.test.ts
 * @description Covers the settings preload boundary — the layer this project
 * forbids bypassing, which had no test of its own. Modelled on
 * `locale.test.ts`: `ipcRenderer` is mocked, so each assertion is about what
 * the bridge does with a payload rather than about main's behaviour.
 *
 * What it protects: the clipboard-fallback read actually round-trips to its own
 * channel (a bridge that answered from a constant would hide a stored OFF), and
 * the write re-validates instead of forwarding — a pass-through preload is the
 * specific regression the project rule exists to prevent.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { messageLabel } from "~/shared/i18n/message";
import { settingsFeature } from "./settings";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: electronMocks,
}));

const invalidClipboardFallback = messageLabel(
  "settings.general.clipboardFallback.invalid",
);

describe("settings preload boundary — clipboard fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getClipboardFallbackEnabled reads its own channel and returns the stored value", async () => {
    electronMocks.invoke.mockResolvedValueOnce(false);

    await expect(settingsFeature.getClipboardFallbackEnabled()).resolves.toBe(
      false,
    );
    expect(electronMocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "get-clipboard-fallback-enabled",
    );
  });

  it("getClipboardFallbackEnabled reports an enabled fallback just as faithfully", async () => {
    electronMocks.invoke.mockResolvedValueOnce(true);

    await expect(settingsFeature.getClipboardFallbackEnabled()).resolves.toBe(
      true,
    );
  });

  it.each([
    ["turning the fallback off", false],
    ["turning it back on", true],
  ])("setClipboardFallbackEnabled forwards %s", async (_label, enabled) => {
    electronMocks.invoke.mockResolvedValueOnce({ success: true, enabled });

    await expect(
      settingsFeature.setClipboardFallbackEnabled(enabled),
    ).resolves.toEqual({ success: true, enabled, error: undefined });
    expect(electronMocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "set-clipboard-fallback-enabled",
      enabled,
    );
  });

  it.each([
    ["a string", "false"],
    ["a number", 0],
    ["null", null],
    ["undefined", undefined],
  ])(
    "setClipboardFallbackEnabled rejects %s at the boundary, with no IPC round-trip",
    async (_label, raw) => {
      // why: the parameter is typed `boolean` for TS call sites, but the
      // renderer is untrusted at runtime — cast past the type to stand in for
      // a bad caller, which is exactly what this guard exists for.
      const invalid = raw as unknown as boolean;

      await expect(
        settingsFeature.setClipboardFallbackEnabled(invalid),
      ).resolves.toEqual({
        success: false,
        error: invalidClipboardFallback,
      });
      expect(electronMocks.invoke).not.toHaveBeenCalled();
    },
  );

  it("setClipboardFallbackEnabled drops a malformed error field rather than passing it to the renderer", async () => {
    electronMocks.invoke.mockResolvedValueOnce({
      success: false,
      error: "a bare string is not a Label",
    });

    await expect(
      settingsFeature.setClipboardFallbackEnabled(false),
    ).resolves.toEqual({ success: false, error: undefined });
  });

  it("setClipboardFallbackEnabled passes a well-formed error Label through untouched", async () => {
    electronMocks.invoke.mockResolvedValueOnce({
      success: false,
      error: invalidClipboardFallback,
    });

    await expect(
      settingsFeature.setClipboardFallbackEnabled(true),
    ).resolves.toEqual({
      success: false,
      error: invalidClipboardFallback,
    });
  });
});
