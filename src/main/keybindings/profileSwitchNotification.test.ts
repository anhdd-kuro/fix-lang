/**
 * @file profileSwitchNotification.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProfileSwitchHotkeyNotification } from "./profileSwitchNotification";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

describe("buildProfileSwitchHotkeyNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the English payload with the profile name interpolated", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildProfileSwitchHotkeyNotification("Работа")).toEqual({
      title: "Profile Switched",
      body: "Switched to profile: Работа",
    });
  });

  it("builds the Japanese payload with the profile name interpolated", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    expect(buildProfileSwitchHotkeyNotification("日本語プロファイル")).toEqual({
      title: "プロフィールを切り替えました",
      body: "プロフィール「日本語プロファイル」に切り替えました。",
    });
  });
});
