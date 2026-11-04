/**
 * @file settings.ts
 * @description IPC handlers for the secret-guard settings store (detector
 * mode + the opt-in high-entropy rule).
 *
 * Raw string channels (`get-secret-guard-settings`,
 * `set-secret-guard-settings`) — only multi-origin channels get a constant in
 * `~/features/core/shared/ipcChannels.ts`.
 *
 * Mirrors `~/features/guards/main/guards.ts`: a malformed payload is REJECTED
 * field by field rather than coerced into defaults, so a buggy renderer cannot
 * quietly turn a privacy guard off while the write still reports success.
 */
import { ipcMain } from "electron";
import { textLabel, type Label } from "~/features/i18n/shared/message";
import { SecretGuardSettingsPayloadSchema } from "~/features/secretGuard/shared/secretGuardSettings";
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";

export const registerSecretGuardHandlers = (): void => {
  ipcMain.handle("get-secret-guard-settings", async () =>
    secretGuardStore.getSecretGuardSettings(),
  );

  ipcMain.handle(
    "set-secret-guard-settings",
    async (
      _event: Electron.IpcMainInvokeEvent,
      settings,
    ): Promise<{ success: boolean; error?: Label }> => {
      // Accepts exactly what `normalizeSecretGuardSettings` leaves unchanged,
      // so a buggy renderer cannot have junk coerced into "off" and reported
      // as a successful write.
      const payload = SecretGuardSettingsPayloadSchema.safeParse(settings);
      if (!payload.success) {
        return {
          success: false,
          error: textLabel("Malformed secret guard settings"),
        };
      }

      try {
        secretGuardStore.setSecretGuardSettings(payload.data);
        return { success: true };
      } catch (error) {
        console.error("Error setting secret guard settings:", error);
        return {
          success: false,
          error: textLabel(
            error instanceof Error ? error.message : "Unknown error",
          ),
        };
      }
    },
  );
};
