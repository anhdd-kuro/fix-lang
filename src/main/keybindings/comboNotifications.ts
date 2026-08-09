/**
 * @file comboNotifications.ts
 * @description Pure builders for a Combo run's user-facing desktop
 * notifications, split out of `correction.ts` so they are testable without
 * constructing an Electron `Notification` — mirrors `correctionNotifications.ts`.
 *
 * Combo notifications get their own titles rather than reusing
 * `notifications.error.title` via `handleError`/`LocalizedError`: a failed
 * step, a user-initiated cancel, and a second press refused by the E10 lock
 * are three different "did not finish" outcomes, and each reads better with
 * its own headline than one shared "FixLang Error" banner.
 */
import { mainT } from "~/main/i18n";

export type NotificationPayload = {
  title: string;
  body: string;
};

/**
 * E4 (design) — names the failing step and its 1-based position, e.g.
 * "Step 2 of 3 — Translate", so the user knows exactly how far the chain got
 * without opening History. `stepPosition` is 1-based; callers pass
 * `stepIndex + 1` from `ComboStepError`.
 */
export const buildComboStepFailedNotification = (params: {
  stepPosition: number;
  totalSteps: number;
  presetName: string;
}): NotificationPayload => ({
  title: mainT("notifications.error.comboFailed.title"),
  body: mainT("notifications.error.comboFailed.body", {
    step: params.stepPosition,
    total: params.totalSteps,
    presetName: params.presetName,
  }),
});

/**
 * The stored combo failed `runCombo`'s t0 re-validation (a deleted preset, a
 * shape the sanitizer admits but `validateCombo` rejects) — zero requests
 * ran. Body key MUST stay `notifications.error.comboInvalid.body`: it is the
 * literal string `ComboValidationFailedError.notificationKey` carries in
 * `comboFlow.ts`, kept as a plain `string` there (not the compile-checked
 * `TKey` union) specifically so that file never depends on a key this one
 * adds to the catalog.
 */
export const buildComboInvalidNotification = (comboName: string): NotificationPayload => ({
  title: mainT("notifications.error.comboFailed.title"),
  body: mainT("notifications.error.comboInvalid.body", { name: comboName }),
});

/** C2 — a single Control+Escape press aborted the run; distinct from a failure. */
export const buildComboCancelledNotification = (comboName: string): NotificationPayload => ({
  title: mainT("notifications.combo.cancelled.title"),
  body: mainT("notifications.combo.cancelled.body", { name: comboName }),
});

/** E10 — a second combo hotkey pressed while one is already running is refused, not queued. */
export const buildComboLockBusyNotification = (): NotificationPayload => ({
  title: mainT("notifications.combo.lockBusy.title"),
  body: mainT("notifications.combo.lockBusy.body"),
});
