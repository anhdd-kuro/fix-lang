/**
 * @file settingsNotifications.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { buildSettingsSavedNotification } from "./settingsNotifications";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

// Expected copy is derived through the real translator kernel — never
// hand-restated — so a catalog reword can't silently break this file, and an
// English-fallback regression still fails a test that asserts JA text.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

describe("buildSettingsSavedNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the English payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildSettingsSavedNotification()).toEqual({
      title: tEn("notifications.settings.saved.title"),
      body: tEn("notifications.settings.saved.body"),
    });
  });

  it("builds the Japanese payload, distinct from English", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildSettingsSavedNotification();
    expect(result).toEqual({
      title: tJa("notifications.settings.saved.title"),
      body: tJa("notifications.settings.saved.body"),
    });
    expect(result.title).not.toBe(tEn("notifications.settings.saved.title"));
    expect(result.body).not.toBe(tEn("notifications.settings.saved.body"));
  });
});
