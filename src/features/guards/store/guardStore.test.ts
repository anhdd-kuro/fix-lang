/**
 * @file guardStore.test.ts
 * @description Round-trip and normalize-on-write behaviour of the selection
 * guard store, including dropping the removed stale-clipboard guard's
 * `clipboardMaxAgeSeconds` from an upgraded user's store. Uses a stateful
 * in-memory backing store so get/set round-trip within a test, mirroring
 * `~/features/autocomplete/store/autocompleteUsageStore.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
} from "~/features/guards/shared/guardSettings";
import { guardStore } from "./guardStore";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

const { storeData } = vi.hoisted(() => ({
  storeData: {} as Record<string, unknown>,
}));

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

const settingsWith = (overrides: Partial<SelectionGuardSettings> = {}): SelectionGuardSettings => ({
  maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
  ...overrides,
});

describe("guardStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeData)) {
      Reflect.deleteProperty(storeData, key);
    }
  });

  it("starts from the normalized defaults before anything is written", () => {
    expect(guardStore.getSelectionGuardSettings()).toEqual(settingsWith());
  });

  it("round-trips a valid write through get", () => {
    const written = settingsWith({
      maxSelectionChars: 5_000,
      deniedBundleIds: ["com.example.app"],
    });

    guardStore.setSelectionGuardSettings(written);

    expect(guardStore.getSelectionGuardSettings()).toEqual(written);
  });

  it("normalizes junk before persisting it, rather than trusting its own caller", () => {
    guardStore.setSelectionGuardSettings({
      maxSelectionChars: -5,
      deniedBundleIds: ["  Com.Example.App  ", "com.example.app"],
    });

    expect(guardStore.getSelectionGuardSettings()).toEqual(
      settingsWith({
        maxSelectionChars: 0,
        deniedBundleIds: ["com.example.app"],
      }),
    );
  });

  it("ignores a legacy clipboardMaxAgeSeconds on read and never writes it back", () => {
    storeData.selectionGuards = {
      clipboardMaxAgeSeconds: 5,
      maxSelectionChars: 1_000,
      deniedBundleIds: ["com.example.app"],
    };

    const read = guardStore.getSelectionGuardSettings();
    expect(read).toEqual(settingsWith({ maxSelectionChars: 1_000, deniedBundleIds: ["com.example.app"] }));

    guardStore.setSelectionGuardSettings({ ...read, maxSelectionChars: 2_000 });

    expect(storeData.selectionGuards).toEqual(
      settingsWith({ maxSelectionChars: 2_000, deniedBundleIds: ["com.example.app"] }),
    );
    expect(Object.keys(storeData.selectionGuards as object)).not.toContain("clipboardMaxAgeSeconds");
  });
});
