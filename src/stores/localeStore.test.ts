/**
 * @file localeStore.test.ts
 * @description Tests for locale persistence. Pure unit tests — no Electron —
 * electron-store is replaced with a stateful in-memory mock so get/set
 * round-trip within a test, mirroring src/stores/apiStore.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocale, initializeLocaleFromSystem, setLocale } from "~/stores/localeStore";
import type { Locale } from "~/shared/i18n/registry";

// Shared mutable backing store for the mock, reset in beforeEach so each test
// starts from a clean "nothing persisted yet" state.
const { storeData } = vi.hoisted(() => ({ storeData: {} as Record<string, unknown> }));

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

describe("localeStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeData)) {
      Reflect.deleteProperty(storeData, key);
    }
  });

  describe("getLocale", () => {
    it("defaults to en when nothing has been persisted", () => {
      expect(getLocale()).toBe("en");
    });

    it("round-trips an explicit choice", () => {
      setLocale("ja");
      expect(getLocale()).toBe("ja");

      setLocale("en");
      expect(getLocale()).toBe("en");
    });

    it("falls back to en for an invalid persisted value", () => {
      // why: force garbage into the store to exercise the invalid-value fallback path
      setLocale("fr" as unknown as Locale);
      expect(getLocale()).toBe("en");
    });
  });

  describe("initializeLocaleFromSystem", () => {
    it("normalizes and persists the system locale when nothing is stored yet", () => {
      expect(initializeLocaleFromSystem("ja-JP")).toBe("ja");
      expect(getLocale()).toBe("ja");
    });

    it("leaves an existing user choice untouched and returns the stored value", () => {
      setLocale("en");
      expect(initializeLocaleFromSystem("ja")).toBe("en");
      expect(getLocale()).toBe("en");
    });

    it("persists en when the system locale is unrecognized", () => {
      expect(initializeLocaleFromSystem("fr-FR")).toBe("en");
      expect(getLocale()).toBe("en");
    });
  });
});
