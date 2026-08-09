/**
 * @file settings.ts
 * @description IPC handlers for reading and writing `settingsAutocomplete`.
 *
 * `updateProfileSetting("settingsAutocomplete", …)` normalizes whatever it is
 * given before writing — it never throws on a malformed shape, it silently
 * coerces one into defaults and writes that. Called from a generic handler,
 * that would mean a malformed renderer payload replaces good settings with
 * defaults instead of failing loudly. This module validates the payload BEFORE
 * it ever reaches `updateProfileSetting`, so a bad write is rejected instead of
 * quietly overwriting the profile's real settings — see plan card 07 and
 * `apiStore.ts`'s `clearInvalidConfig: true` note above `settingsAutocomplete`.
 */
import { ipcMain } from "electron";
import {
  normalizeAutocompleteSettings,
  type AutocompleteSettings,
} from "~/features/autocomplete/shared/autocompleteSettings";
import {
  getProfileSetting,
  updateProfileSetting,
} from "~/features/providers/store/apiStore";

/**
 * Field-by-field check, mirroring `~/features/ask/preload/ask.ts`: the shape
 * is small enough that widening any field to `unknown` would just move the
 * failure from "rejected here" to "coerced into defaults downstream".
 */
const isAutocompleteSettings = (
  value: unknown,
): value is AutocompleteSettings => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === "boolean" && typeof record.model === "string"
  );
};

export const registerAutocompleteSettingsHandlers = (): void => {
  ipcMain.handle("get-autocomplete-settings", async () => {
    try {
      // Normalize here rather than trusting `getProfileSetting` to have done
      // it: this handler owns criterion 1 ("returns the normalized settings"),
      // so its proof cannot live only in apiStore.ts.
      return normalizeAutocompleteSettings(
        getProfileSetting("settingsAutocomplete"),
      );
    } catch (error) {
      console.error("Error getting autocomplete settings:", error);
      return normalizeAutocompleteSettings(undefined);
    }
  });

  ipcMain.handle(
    "set-autocomplete-settings",
    async (
      _event: Electron.IpcMainInvokeEvent,
      settings: unknown,
    ): Promise<{ success: boolean; error?: string }> => {
      if (!isAutocompleteSettings(settings)) {
        return { success: false, error: "Malformed autocomplete settings" };
      }

      try {
        return updateProfileSetting("settingsAutocomplete", settings);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );
};
