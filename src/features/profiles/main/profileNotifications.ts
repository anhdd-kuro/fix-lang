/**
 * @file profileNotifications.ts
 * @description Pure builders for profile lifecycle notifications, split out
 * of `profiles.ts` so they're testable without constructing an Electron
 * `Notification`.
 */
import { mainT } from "~/main/i18n";

export type NotificationPayload = {
  title: string;
  body: string;
};

export type ProfileNotificationKind =
  | "created"
  | "applied"
  | "updated"
  | "deleted"
  | "imported"
  | "switched";

/**
 * Builds the `{ title, body }` notification payload for a profile lifecycle
 * event (create / apply / update / delete / import / switch via IPC).
 * `name` is user-authored profile data — interpolated, never translated.
 */
export const buildProfileNotification = (
  kind: ProfileNotificationKind,
  name: string,
): NotificationPayload => ({
  title: mainT(`notifications.profile.${kind}.title`),
  body: mainT(`notifications.profile.${kind}.body`, { name }),
});

/**
 * Shown when profile settings changed in bulk (`profile-updated` event) with
 * no single named profile to interpolate.
 */
export const buildProfilesUpdatedNotification = (): NotificationPayload => ({
  title: mainT("notifications.profilesUpdated.title"),
  body: mainT("notifications.profilesUpdated.body"),
});
