/**
 * @file correctionNotifications.ts
 * @description Pure builders for the correction hotkey's user-facing text,
 * split out of `correction.ts` so they're testable without constructing an
 * Electron `Notification` or `BrowserWindow`.
 */
import { mainT } from "~/main/i18n";

export type NotificationPayload = {
  title: string;
  body: string;
};

/** Shown when a correction pass makes no changes to already-correct text. */
export const buildCorrectionGoodJobNotification = (): NotificationPayload => ({
  title: mainT("notifications.correction.goodJob.title"),
  body: mainT("notifications.correction.goodJob.body"),
});
