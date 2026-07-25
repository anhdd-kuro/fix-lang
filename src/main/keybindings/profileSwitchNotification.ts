/**
 * @file profileSwitchNotification.ts
 * @description Pure builder for the profile-switch global hotkey's
 * notification text, split out of `profileSwitch.ts` for testability.
 */
import { mainT } from "~/main/i18n";

export type NotificationPayload = {
  title: string;
  body: string;
};

/**
 * Shown after the profile-switch global hotkey activates the next profile.
 * `name` is user-authored profile data — interpolated, never translated.
 */
export const buildProfileSwitchHotkeyNotification = (
  name: string,
): NotificationPayload => ({
  title: mainT("notifications.profile.switched.title"),
  body: mainT("notifications.profile.switchedByHotkey.body", { name }),
});
