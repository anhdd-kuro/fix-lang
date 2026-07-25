/**
 * @file settingsNotifications.ts
 * @description Pure builder for the "settings saved" notification, split out
 * of `settings.ts` so it's testable without constructing an Electron
 * `Notification` (same split as `profileNotifications.ts`).
 */
import { mainT } from "~/main/i18n";

export type NotificationPayload = {
  title: string;
  body: string;
};

/** Shown when the renderer broadcasts `settings-updated` (no dynamic data). */
export const buildSettingsSavedNotification = (): NotificationPayload => ({
  title: mainT("notifications.settings.saved.title"),
  body: mainT("notifications.settings.saved.body"),
});
