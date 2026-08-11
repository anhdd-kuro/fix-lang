/**
 * @file secretGuard.test.ts
 * @description The preload half of the secret-guard settings bridge. It
 * validates in BOTH directions independently of the main-process handler: a
 * malformed reply must not reach React, and a malformed outgoing payload must
 * not reach `ipcRenderer.invoke` just because TypeScript said it was fine at
 * compile time.
 *
 * The fallback on a bad reply is the normalized DEFAULT (`confirm`), never
 * `off` — a broken reply must not read as "the guard is disabled".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECRET_GUARD_SETTINGS } from "~/features/secretGuard/shared/secretGuardSettings";
import { secretGuardFeature } from "./secretGuard";

const electronMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("electron", () => ({ ipcRenderer: electronMocks }));

const validSettings = { mode: "mask", highEntropyRule: true } as const;

const malformedPayloads = [
  undefined,
  null,
  "a string",
  42,
  [],
  { mode: "confirm" },
  { highEntropyRule: false },
  { mode: "maybe", highEntropyRule: false },
  { mode: "Confirm", highEntropyRule: false },
  { mode: 1, highEntropyRule: false },
  { mode: "confirm", highEntropyRule: 1 },
  { mode: "confirm", highEntropyRule: "true" },
  { mode: "confirm", highEntropyRule: null },
];

describe("secretGuardFeature preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSecretGuardSettings", () => {
    it("invokes get-secret-guard-settings and returns a valid result", async () => {
      electronMocks.invoke.mockResolvedValue(validSettings);

      const result = await secretGuardFeature.getSecretGuardSettings();

      expect(electronMocks.invoke).toHaveBeenCalledWith("get-secret-guard-settings");
      expect(result).toEqual(validSettings);
    });

    it.each(malformedPayloads)(
      "falls back to the safe defaults for a malformed reply: %j",
      async (reply) => {
        electronMocks.invoke.mockResolvedValue(reply);

        expect(await secretGuardFeature.getSecretGuardSettings()).toEqual(
          DEFAULT_SECRET_GUARD_SETTINGS,
        );
      },
    );

    it("passes through mode off — a disabled guard is a valid stored choice", async () => {
      electronMocks.invoke.mockResolvedValue({ mode: "off", highEntropyRule: false });

      expect(await secretGuardFeature.getSecretGuardSettings()).toEqual({
        mode: "off",
        highEntropyRule: false,
      });
    });
  });

  describe("setSecretGuardSettings", () => {
    it("forwards a valid payload and reports success", async () => {
      electronMocks.invoke.mockResolvedValue({ success: true });

      const result = await secretGuardFeature.setSecretGuardSettings(validSettings);

      expect(electronMocks.invoke).toHaveBeenCalledWith(
        "set-secret-guard-settings",
        validSettings,
      );
      expect(result).toEqual({ success: true, error: undefined });
    });

    it.each(malformedPayloads)(
      "rejects a malformed payload before it reaches IPC: %j",
      async (payload) => {
        const result = await secretGuardFeature.setSecretGuardSettings(
          payload as never,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(electronMocks.invoke).not.toHaveBeenCalled();
      },
    );

    it("surfaces a main-process error label", async () => {
      electronMocks.invoke.mockResolvedValue({
        success: false,
        error: { kind: "text", text: "nope" },
      });

      const result = await secretGuardFeature.setSecretGuardSettings(validSettings);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
