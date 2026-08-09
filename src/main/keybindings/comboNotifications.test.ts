/**
 * @file comboNotifications.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  buildComboCancelledNotification,
  buildComboInvalidNotification,
  buildComboLockBusyNotification,
  buildComboStepFailedNotification,
} from "./comboNotifications";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

// Expected copy is derived through the real translator kernel so a catalog
// reword can't silently break this file.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

describe("buildComboStepFailedNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the failing step and its 1-based position in the English payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    const result = buildComboStepFailedNotification({
      stepPosition: 2,
      totalSteps: 3,
      presetName: "Translate",
    });

    expect(result).toEqual({
      title: tEn("notifications.error.comboFailed.title"),
      body: tEn("notifications.error.comboFailed.body", {
        step: 2,
        total: 3,
        presetName: "Translate",
      }),
    });
    expect(result.body).toContain("2");
    expect(result.body).toContain("3");
    expect(result.body).toContain("Translate");
  });

  it("builds the Japanese payload with the same step/total/presetName", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildComboStepFailedNotification({
      stepPosition: 1,
      totalSteps: 2,
      presetName: "Summarize",
    });

    expect(result).toEqual({
      title: tJa("notifications.error.comboFailed.title"),
      body: tJa("notifications.error.comboFailed.body", {
        step: 1,
        total: 2,
        presetName: "Summarize",
      }),
    });
    expect(result.title).not.toBe(tEn("notifications.error.comboFailed.title"));
  });
});

describe("buildComboInvalidNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the combo in the English payload, sharing comboFailed's title", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    const result = buildComboInvalidNotification("My Combo");

    expect(result).toEqual({
      title: tEn("notifications.error.comboFailed.title"),
      body: tEn("notifications.error.comboInvalid.body", { name: "My Combo" }),
    });
    expect(result.body).toContain("My Combo");
  });

  it("builds the Japanese payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildComboInvalidNotification("My Combo");

    expect(result).toEqual({
      title: tJa("notifications.error.comboFailed.title"),
      body: tJa("notifications.error.comboInvalid.body", { name: "My Combo" }),
    });
  });
});

describe("buildComboCancelledNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is distinct from the failed/invalid notifications' title", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    const cancelled = buildComboCancelledNotification("My Combo");
    const failed = buildComboStepFailedNotification({
      stepPosition: 1,
      totalSteps: 2,
      presetName: "Correction",
    });

    expect(cancelled).toEqual({
      title: tEn("notifications.combo.cancelled.title"),
      body: tEn("notifications.combo.cancelled.body", { name: "My Combo" }),
    });
    expect(cancelled.title).not.toBe(failed.title);
  });

  it("builds the Japanese payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildComboCancelledNotification("My Combo");

    expect(result).toEqual({
      title: tJa("notifications.combo.cancelled.title"),
      body: tJa("notifications.combo.cancelled.body", { name: "My Combo" }),
    });
  });
});

describe("buildComboLockBusyNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is distinct from the cancelled notification's title and takes no combo name", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    const busy = buildComboLockBusyNotification();
    const cancelled = buildComboCancelledNotification("My Combo");

    expect(busy).toEqual({
      title: tEn("notifications.combo.lockBusy.title"),
      body: tEn("notifications.combo.lockBusy.body"),
    });
    expect(busy.title).not.toBe(cancelled.title);
  });

  it("builds the Japanese payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildComboLockBusyNotification();

    expect(result).toEqual({
      title: tJa("notifications.combo.lockBusy.title"),
      body: tJa("notifications.combo.lockBusy.body"),
    });
  });
});
