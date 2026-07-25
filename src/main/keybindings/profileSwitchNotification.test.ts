/**
 * @file profileSwitchNotification.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { buildProfileSwitchHotkeyNotification } from "./profileSwitchNotification";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

// Expected copy is derived through the real translator kernel so a catalog
// reword can't silently break this file.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

describe("buildProfileSwitchHotkeyNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the English payload with the profile name interpolated", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildProfileSwitchHotkeyNotification("Работа")).toEqual({
      title: tEn("notifications.profile.switched.title"),
      body: tEn("notifications.profile.switchedByHotkey.body", { name: "Работа" }),
    });
  });

  it("builds the Japanese payload with the profile name interpolated", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildProfileSwitchHotkeyNotification("日本語プロファイル");
    expect(result).toEqual({
      title: tJa("notifications.profile.switched.title"),
      body: tJa("notifications.profile.switchedByHotkey.body", {
        name: "日本語プロファイル",
      }),
    });
    // Prove the locale actually changed the wording.
    expect(result.title).not.toBe(tEn("notifications.profile.switched.title"));
  });
});
