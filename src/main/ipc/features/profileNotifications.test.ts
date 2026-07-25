/**
 * @file profileNotifications.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProfileNotification,
  buildProfilesUpdatedNotification,
  type ProfileNotificationKind,
} from "./profileNotifications";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

const KIND_EXPECTATIONS: Record<
  ProfileNotificationKind,
  { en: NotificationPayload; ja: NotificationPayload }
> = {
  created: {
    en: {
      title: "Profile Created",
      body: 'Profile "{name}" has been created and activated.',
    },
    ja: {
      title: "プロファイルを作成しました",
      body: "プロファイル「{name}」を作成し、有効にしました。",
    },
  },
  applied: {
    en: { title: "Profile Applied", body: 'Profile "{name}" has been activated.' },
    ja: { title: "プロファイルを適用しました", body: "プロファイル「{name}」を有効にしました。" },
  },
  updated: {
    en: { title: "Profile Updated", body: 'Profile "{name}" has been updated.' },
    ja: { title: "プロファイルを更新しました", body: "プロファイル「{name}」を更新しました。" },
  },
  deleted: {
    en: { title: "Profile Deleted", body: 'Profile "{name}" has been deleted.' },
    ja: { title: "プロファイルを削除しました", body: "プロファイル「{name}」を削除しました。" },
  },
  imported: {
    en: { title: "Profile Imported", body: 'Profile "{name}" has been imported.' },
    ja: { title: "プロファイルをインポートしました", body: "プロファイル「{name}」をインポートしました。" },
  },
  switched: {
    en: { title: "Profile Switched", body: 'Profile "{name}" has been activated.' },
    ja: { title: "プロファイルを切り替えました", body: "プロファイル「{name}」を有効にしました。" },
  },
};

type NotificationPayload = { title: string; body: string };

const withName = (payload: NotificationPayload, name: string): NotificationPayload => ({
  title: payload.title,
  body: payload.body.replace("{name}", name),
});

describe("buildProfileNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(Object.keys(KIND_EXPECTATIONS) as ProfileNotificationKind[])(
    "builds the English payload for kind %s with the profile name interpolated",
    (kind) => {
      localeStoreMocks.getLocale.mockReturnValue("en");

      expect(buildProfileNotification(kind, "日本語プロファイル")).toEqual(
        withName(KIND_EXPECTATIONS[kind].en, "日本語プロファイル"),
      );
    },
  );

  it.each(Object.keys(KIND_EXPECTATIONS) as ProfileNotificationKind[])(
    "builds the Japanese payload for kind %s with the profile name interpolated",
    (kind) => {
      localeStoreMocks.getLocale.mockReturnValue("ja");

      expect(buildProfileNotification(kind, "Работа")).toEqual(
        withName(KIND_EXPECTATIONS[kind].ja, "Работа"),
      );
    },
  );
});

describe("buildProfilesUpdatedNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the English payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildProfilesUpdatedNotification()).toEqual({
      title: "Profiles Updated",
      body: "Your profile settings have been updated.",
    });
  });

  it("builds the Japanese payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    expect(buildProfilesUpdatedNotification()).toEqual({
      title: "プロファイル設定を更新しました",
      body: "プロファイルの設定を更新しました。",
    });
  });
});
