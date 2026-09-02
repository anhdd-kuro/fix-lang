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
import { SECRET_GUARD_MODES } from "~/features/secretGuard/shared/secretGuardSettings";
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";
import type {
  SecretGuardMode,
  SecretGuardSettings,
} from "~/features/secretGuard/shared/secretGuardSettings";

/**
 * `isSecretGuardMode` is module-private in `secretGuardSettings.ts`, so this
 * boundary writes its own membership check against the exported
 * `SECRET_GUARD_MODES` — the same shape as `isAutocompleteSettings`, and the
 * reason the value set is exported at all: the two cannot drift.
 */
const isSecretGuardMode = (value: unknown): value is SecretGuardMode =>
  SECRET_GUARD_MODES.includes(value as SecretGuardMode);

/**
 * Accepts exactly the values `normalizeSecretGuardSettings` leaves unchanged.
 * That equivalence is the point: a predicate that accepted something the
 * normalizer then rewrote would report a successful write of settings the user
 * never chose. `highEntropyRule` therefore requires a real boolean — the
 * normalizer's `=== true` would silently turn `1`, `"true"` or `null` into
 * `false`, i.e. into "off" — while `false` itself stays perfectly legal, since
 * it is the documented way to leave the opt-in rule alone. `mode: "off"` is
 * likewise legal: turning the guard off is a choice, not a malformed payload.
 */
const isSecretGuardSettings = (value: unknown): value is SecretGuardSettings => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isSecretGuardMode(record.mode) && typeof record.highEntropyRule === "boolean";
};

export const registerSecretGuardHandlers = (): void => {
  ipcMain.handle("get-secret-guard-settings", async () =>
    secretGuardStore.getSecretGuardSettings(),
  );

  ipcMain.handle(
    "set-secret-guard-settings",
    async (
      _event: Electron.IpcMainInvokeEvent,
      settings: unknown,
    ): Promise<{ success: boolean; error?: Label }> => {
      if (!isSecretGuardSettings(settings)) {
        return {
          success: false,
          error: textLabel("Malformed secret guard settings"),
        };
      }

      try {
        secretGuardStore.setSecretGuardSettings(settings);
        return { success: true };
      } catch (error) {
        console.error("Error setting secret guard settings:", error);
        return {
          success: false,
          error: textLabel(error instanceof Error ? error.message : "Unknown error"),
        };
      }
    },
  );
};
