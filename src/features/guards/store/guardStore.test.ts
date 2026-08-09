/**
 * @file guardStore.test.ts
 * @description The 0 <-> non-0 `clipboardMaxAgeSeconds` transition is the
 * load-bearing behaviour here: it is what starts/stops the 1 Hz clipboard
 * poll immediately on write instead of at next launch. Uses a stateful
 * in-memory backing store so get/set round-trip within a test, mirroring
 * `~/features/autocomplete/store/autocompleteUsageStore.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
} from "~/features/guards/shared/guardSettings";
import { guardStore } from "./guardStore";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

const { storeData, applySettingsMock } = vi.hoisted(() => ({
  storeData: {} as Record<string, unknown>,
  applySettingsMock: vi.fn(),
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

vi.mock("~/main/clipboard/clipboardChangeTracker", () => ({
  applySettings: applySettingsMock,
}));

const settingsWith = (overrides: Partial<SelectionGuardSettings> = {}): SelectionGuardSettings => ({
  clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
  ...overrides,
});

describe("guardStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeData)) {
      Reflect.deleteProperty(storeData, key);
    }
    applySettingsMock.mockClear();
  });

  it("starts from the normalized defaults before anything is written", () => {
    expect(guardStore.getSelectionGuardSettings()).toEqual(settingsWith());
  });

  it("round-trips a valid write through get", () => {
    const written = settingsWith({
      clipboardMaxAgeSeconds: 12,
      maxSelectionChars: 5_000,
      deniedBundleIds: ["com.example.app"],
    });

    guardStore.setSelectionGuardSettings(written);

    expect(guardStore.getSelectionGuardSettings()).toEqual(written);
  });

  it("normalizes junk before persisting it, rather than trusting its own caller", () => {
    guardStore.setSelectionGuardSettings({
      clipboardMaxAgeSeconds: Number.NaN,
      maxSelectionChars: -5,
      deniedBundleIds: ["  Com.Example.App  ", "com.example.app"],
    } as SelectionGuardSettings);

    expect(guardStore.getSelectionGuardSettings()).toEqual(
      settingsWith({
        clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
        maxSelectionChars: 0,
        deniedBundleIds: ["com.example.app"],
      }),
    );
  });

  it("starts the poll immediately on a 0 -> non-0 write", () => {
    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 0 }));
    applySettingsMock.mockClear();

    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 7 }));

    expect(applySettingsMock).toHaveBeenCalledTimes(1);
    expect(applySettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clipboardMaxAgeSeconds: 7 }),
    );
  });

  it("stops the poll immediately on a non-0 -> 0 write", () => {
    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 5 }));
    applySettingsMock.mockClear();

    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 0 }));

    expect(applySettingsMock).toHaveBeenCalledTimes(1);
    expect(applySettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clipboardMaxAgeSeconds: 0 }),
    );
  });

  it("does not re-apply clipboard tracker settings on a non-0 -> non-0 write", () => {
    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 5 }));
    applySettingsMock.mockClear();

    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 9 }));

    expect(applySettingsMock).not.toHaveBeenCalled();
  });

  it("does not re-apply clipboard tracker settings on a 0 -> 0 write", () => {
    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 0 }));
    applySettingsMock.mockClear();

    guardStore.setSelectionGuardSettings(settingsWith({ clipboardMaxAgeSeconds: 0, maxSelectionChars: 1 }));

    expect(applySettingsMock).not.toHaveBeenCalled();
  });
});
