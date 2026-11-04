/**
 * @file secretGuardStore.test.ts
 * @description Round-trip plus the two fail-direction rules that make this a
 * safety rail rather than a preference: junk `mode` lands on `"confirm"` (fail
 * SAFE) and junk `highEntropyRule` lands on `false` (fail QUIET). Uses a
 * stateful in-memory backing store so get/set round-trip within one test,
 * mirroring `~/features/guards/store/guardStore.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECRET_GUARD_SETTINGS } from "~/features/secretGuard/shared/secretGuardSettings";
import { secretGuardStore } from "./secretGuardStore";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";
import type { Options } from "electron-store";

/** What an electron-store file can hold: the backing data of the mock below. */
type StoredJson =
  | string
  | number
  | boolean
  | null
  | StoredJson[]
  | { [key: string]: StoredJson };

const { storeData, storeOptions } = vi.hoisted(() => ({
  storeData: {} as Record<string, StoredJson>,
  storeOptions: [] as Options<Record<string, StoredJson>>[],
}));

vi.mock("electron-store", () => {
  class MockStore {
    constructor(options: Options<Record<string, StoredJson>>) {
      storeOptions.push(options);
    }
    get(key: string, defaultValue?: StoredJson) {
      return key in storeData ? storeData[key] : defaultValue;
    }
    set(key: string, value: StoredJson) {
      storeData[key] = value;
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});

describe("secretGuardStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeData)) {
      Reflect.deleteProperty(storeData, key);
    }
  });

  it("is a standalone, schema-free store with clearInvalidConfig on", () => {
    const options = storeOptions[0];

    expect(options.name).toBe("secretGuard");
    expect(options.clearInvalidConfig).toBe(true);
    // No ajv schema, deliberately: one invalid stored value wipes the store,
    // so its blast radius is confined to these two fields.
    expect(options.schema).toBeUndefined();
  });

  it("starts from the documented defaults before anything is written", () => {
    expect(secretGuardStore.getSecretGuardSettings()).toEqual(
      DEFAULT_SECRET_GUARD_SETTINGS,
    );
    expect(DEFAULT_SECRET_GUARD_SETTINGS).toEqual({
      mode: "confirm",
      highEntropyRule: false,
    });
  });

  it.each<SecretGuardSettings>([
    { mode: "off", highEntropyRule: false },
    { mode: "confirm", highEntropyRule: true },
    { mode: "mask", highEntropyRule: false },
    { mode: "mask", highEntropyRule: true },
  ])("round-trips %o through get", (written) => {
    secretGuardStore.setSecretGuardSettings(written);

    expect(secretGuardStore.getSecretGuardSettings()).toEqual(written);
  });

  it("normalizes junk before persisting it, rather than trusting its own caller", () => {
    // Junk the type system cannot express, arriving the way junk really does:
    // through a JSON boundary that yields `any`.
    const junk: SecretGuardSettings = JSON.parse(
      '{ "mode": "MASK", "highEntropyRule": "yes" }',
    );
    secretGuardStore.setSecretGuardSettings(junk);

    expect(secretGuardStore.getSecretGuardSettings()).toEqual({
      mode: "confirm",
      highEntropyRule: false,
    });
  });

  it("reads junk already on disk as confirm + entropy off, never as off", () => {
    storeData.secretGuard = { mode: 42, highEntropyRule: 1 };

    expect(secretGuardStore.getSecretGuardSettings()).toEqual({
      mode: "confirm",
      highEntropyRule: false,
    });
  });
});
