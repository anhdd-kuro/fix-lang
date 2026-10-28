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
  SecretGuardSettingsPayloadSchema,
} from "~/features/secretGuard/shared/secretGuardSettings";
import { asLabel } from "~/features/settings/preload/ipcLabel";
import type { SecretGuardSettings } from "~/features/secretGuard/shared/secretGuardSettings";

export const secretGuardFeature = {
  /** A malformed reply falls back to the SAFE defaults (`confirm`), never to `off`. */
  getSecretGuardSettings: async (): Promise<SecretGuardSettings> => {
    // The same payload schema the main-process handler applies
    // (`~/features/secretGuard/main/settings.ts`), validated independently.
    const reply = SecretGuardSettingsPayloadSchema.safeParse(
      await ipcRenderer.invoke("get-secret-guard-settings"),
    );
    return reply.success ? reply.data : DEFAULT_SECRET_GUARD_SETTINGS;
  },

  setSecretGuardSettings: async (
    settings: SecretGuardSettings,
  ): Promise<{ success: boolean; error?: Label }> => {
    if (!SecretGuardSettingsPayloadSchema.safeParse(settings).success) {
      return {
        success: false,
        error: textLabel("Malformed secret guard settings"),
      };
    }
    const result = await ipcRenderer.invoke(
      "set-secret-guard-settings",
      settings,
    );
    return { success: Boolean(result?.success), error: asLabel(result?.error) };
  },
};

export type SecretGuardFeature = typeof secretGuardFeature;
