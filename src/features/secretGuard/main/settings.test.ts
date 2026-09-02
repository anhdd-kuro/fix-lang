/**
 * @file settings.test.ts
 * @description The secret-guard settings IPC seam. Runs the REAL
 * `secretGuardStore` over an in-memory `electron-store` mock, so a round trip
 * here proves the handler, the store and the normalizer agree rather than
 * proving a mock was called.
 *
 * Three things are load-bearing:
 *   1. A round trip preserves every legitimate value, INCLUDING the ones that
 *      mean "off" (`mode: "off"`, `highEntropyRule: false`).
 *   2. Junk already on disk reads back as `confirm` + entropy `false` — fail
 *      SAFE on the mode, fail QUIET on the opt-in rule.
 *   3. A malformed payload is REJECTED field by field, never coerced. Coercing
 *      would let a buggy renderer disable a privacy guard while the write still
 *      reports success. The predicate accepts exactly the values normalization
 *      leaves unchanged: anything the normalizer would rewrite is refused here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_GUARD_MODES } from "~/features/secretGuard/shared/secretGuardSettings";
import { registerSecretGuardHandlers } from "./settings";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";

const { electronMocks, storeData } = vi.hoisted(() => ({
  electronMocks: { handle: vi.fn() },
  storeData: {} as Record<string, unknown>,
}));

vi.mock("electron", () => ({ ipcMain: { handle: electronMocks.handle } }));

vi.mock("electron-store", () => {
  class MockStore {
    get(key: string, defaultValue?: unknown) {
      return key in storeData ? storeData[key] : defaultValue;
    }
    set(key: string, value: unknown) {
      storeData[key] = value;
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});

type Handler = (event: unknown, raw?: unknown) => unknown;

const getHandler = (channel: string): Handler => {
  const call = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`no handler registered for channel "${channel}"`);
  return call[1] as Handler;
};

const read = async () => getHandler("get-secret-guard-settings")(undefined);
const write = async (payload: unknown) =>
  (await getHandler("set-secret-guard-settings")(undefined, payload)) as {
    success: boolean;
    error?: unknown;
  };

describe("registerSecretGuardHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(storeData)) {
      Reflect.deleteProperty(storeData, key);
    }
    registerSecretGuardHandlers();
  });

  it("registers both raw string channels", () => {
    const channels = electronMocks.handle.mock.calls.map(([name]) => name);

    expect(channels).toContain("get-secret-guard-settings");
    expect(channels).toContain("set-secret-guard-settings");
  });

  it("reads the safe defaults before anything is written", async () => {
    expect(await read()).toEqual({ mode: "confirm", highEntropyRule: false });
  });

  it.each<SecretGuardSettings>([
    { mode: "off", highEntropyRule: false },
    { mode: "off", highEntropyRule: true },
    { mode: "confirm", highEntropyRule: false },
    { mode: "confirm", highEntropyRule: true },
    { mode: "mask", highEntropyRule: false },
    { mode: "mask", highEntropyRule: true },
  ])("round-trips %o unchanged", async (settings) => {
    expect(await write(settings)).toEqual({ success: true });
    expect(await read()).toEqual(settings);
  });

  it("accepts every member of SECRET_GUARD_MODES", async () => {
    for (const mode of SECRET_GUARD_MODES) {
      expect(await write({ mode, highEntropyRule: false })).toEqual({ success: true });
    }
  });

  it("reads a junk mode already on disk as confirm, never as off", async () => {
    storeData.secretGuard = { mode: "MASK", highEntropyRule: false };

    expect(await read()).toEqual({ mode: "confirm", highEntropyRule: false });
  });

  it("reads a junk high-entropy flag already on disk as false", async () => {
    storeData.secretGuard = { mode: "mask", highEntropyRule: "yes" };

    expect(await read()).toEqual({ mode: "mask", highEntropyRule: false });
  });

  it.each([
    ["not an object", "confirm"],
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a number", 42],
    ["a missing mode", { highEntropyRule: false }],
    ["a missing entropy flag", { mode: "confirm" }],
    ["an unknown mode", { mode: "maybe", highEntropyRule: false }],
    ["a wrong-case mode", { mode: "Confirm", highEntropyRule: false }],
    ["a numeric mode", { mode: 1, highEntropyRule: false }],
    ["a truthy non-boolean entropy flag", { mode: "confirm", highEntropyRule: 1 }],
    ["a string entropy flag", { mode: "confirm", highEntropyRule: "true" }],
    ["a null entropy flag", { mode: "confirm", highEntropyRule: null }],
  ])("rejects %s rather than coercing it", async (_label, payload) => {
    const result = await write(payload);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("leaves the stored value untouched when a write is rejected", async () => {
    await write({ mode: "mask", highEntropyRule: true });

    expect(await write({ mode: "nonsense", highEntropyRule: true })).toEqual(
      expect.objectContaining({ success: false }),
    );
    expect(await read()).toEqual({ mode: "mask", highEntropyRule: true });
  });
});
