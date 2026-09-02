/**
 * @file profileNotifications.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  buildProfileNotification,
  buildProfilesUpdatedNotification,
  type ProfileNotificationKind,
} from "./profileNotifications";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

// Expected copy is derived through the real translator kernel — never
// hand-restated, and never hand-interpolated via `.replace(...)` — so a
// catalog reword can't silently break this file, and an English-fallback
// regression still fails a test that asserts JA text.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const KINDS: ProfileNotificationKind[] = [
  "created",
  "applied",
  "updated",
  "deleted",
  "imported",
  "switched",
];

describe("buildProfileNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(KINDS)(
    "builds the English payload for kind %s with the profile name interpolated",
    (kind) => {
      localeStoreMocks.getLocale.mockReturnValue("en");
      const name = "日本語プロファイル";

      expect(buildProfileNotification(kind, name)).toEqual({
        title: tEn(`notifications.profile.${kind}.title`),
        body: tEn(`notifications.profile.${kind}.body`, { name }),
      });
    },
  );

  it.each(KINDS)(
    "builds the Japanese payload for kind %s with the profile name interpolated",
    (kind) => {
      localeStoreMocks.getLocale.mockReturnValue("ja");
      const name = "Работа";

      const result = buildProfileNotification(kind, name);
      expect(result).toEqual({
        title: tJa(`notifications.profile.${kind}.title`),
        body: tJa(`notifications.profile.${kind}.body`, { name }),
      });
      // Prove the locale actually changed the wording (title has no
      // interpolated user data, so it's a clean EN/JA comparison).
      expect(result.title).not.toBe(tEn(`notifications.profile.${kind}.title`));
    },
  );
});

describe("buildProfilesUpdatedNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the English payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildProfilesUpdatedNotification()).toEqual({
      title: tEn("notifications.profilesUpdated.title"),
      body: tEn("notifications.profilesUpdated.body"),
    });
  });

  it("builds the Japanese payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildProfilesUpdatedNotification();
    expect(result).toEqual({
      title: tJa("notifications.profilesUpdated.title"),
      body: tJa("notifications.profilesUpdated.body"),
    });
    expect(result.title).not.toBe(tEn("notifications.profilesUpdated.title"));
  });
});
