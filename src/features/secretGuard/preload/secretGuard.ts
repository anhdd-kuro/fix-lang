/**
 * @file secretGuard.ts
 * @description Preload bridge for the secret-guard settings store.
 *
 * Validated in both directions, mirroring
 * `~/features/guards/preload/guards.ts`: a malformed main-process reply is
 * dropped before it reaches React, and a malformed outgoing payload is
 * rejected here rather than trusting the caller's TypeScript type, which only
 * holds at compile time. Never bypass this — every IPC boundary in this app
 * validates independently on both sides.
 */
import { ipcRenderer } from "electron";
import { textLabel, type Label } from "~/features/i18n/shared/message";
import {
  DEFAULT_SECRET_GUARD_SETTINGS,
  SECRET_GUARD_MODES,
} from "~/features/secretGuard/shared/secretGuardSettings";
import { asLabel } from "~/features/settings/preload/ipcLabel";
import type {
  SecretGuardMode,
  SecretGuardSettings,
} from "~/features/secretGuard/shared/secretGuardSettings";

/** Own membership check — `isSecretGuardMode` is module-private in the shared file, so `SECRET_GUARD_MODES` is the shared value set both boundaries read. */
const isSecretGuardMode = (value: unknown): value is SecretGuardMode =>
  SECRET_GUARD_MODES.includes(value as SecretGuardMode);

/**
 * The same predicate the main-process handler applies
 * (`~/features/secretGuard/main/settings.ts`): accept exactly the values the
 * normalizer leaves unchanged. `mode: "off"` and `highEntropyRule: false` are
 * legitimate choices and stay legal; a non-boolean entropy flag is refused,
 * because normalization would turn it into "off" without saying so.
 */
const isSecretGuardSettings = (value: unknown): value is SecretGuardSettings => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isSecretGuardMode(record.mode) && typeof record.highEntropyRule === "boolean";
};

export const secretGuardFeature = {
  /** A malformed reply falls back to the SAFE defaults (`confirm`), never to `off`. */
  getSecretGuardSettings: async (): Promise<SecretGuardSettings> => {
    const result: unknown = await ipcRenderer.invoke("get-secret-guard-settings");
    return isSecretGuardSettings(result) ? result : DEFAULT_SECRET_GUARD_SETTINGS;
  },

  setSecretGuardSettings: async (
    settings: SecretGuardSettings,
  ): Promise<{ success: boolean; error?: Label }> => {
    if (!isSecretGuardSettings(settings)) {
      return {
        success: false,
        error: textLabel("Malformed secret guard settings"),
      };
    }
    const result = await ipcRenderer.invoke("set-secret-guard-settings", settings);
    return { success: Boolean(result?.success), error: asLabel(result?.error) };
  },
};

export type SecretGuardFeature = typeof secretGuardFeature;
