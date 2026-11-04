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
import { AutocompleteSettingsSchema } from "~/features/autocomplete/shared/autocompleteSchemas";
import { normalizeAutocompleteSettings } from "~/features/autocomplete/shared/autocompleteSettings";
import {
  getProfileSetting,
  updateProfileSetting,
} from "~/features/providers/store/apiStore";

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
      settings,
    ): Promise<{ success: boolean; error?: string }> => {
      // Validated BEFORE `updateProfileSetting`, which would otherwise coerce a
      // malformed payload into defaults and write those over good settings.
      // The cap must be finite — `estimatedCostUsd >= NaN` and `>= Infinity`
      // are both always false, a budget that never fires — but its RANGE is
      // clamped downstream (`normalizeDailyCostCapUsd`), not refused here.
      if (!AutocompleteSettingsSchema.safeParse(settings).success) {
        return { success: false, error: "Malformed autocomplete settings" };
      }

      try {
        // The payload itself, exactly as validated — `updateProfileSetting`
        // normalizes whatever it writes.
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
