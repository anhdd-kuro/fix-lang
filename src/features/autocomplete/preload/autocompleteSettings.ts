/**
 * @file autocompleteSettings.ts
 * @description Preload bridge for reading/writing `settingsAutocomplete`.
 *
 * A separate module from `~/features/autocomplete/preload/autocomplete.ts` on
 * purpose — that file is the suggestion/usage bridge owned by another card in
 * this run. This repo already splits one feature across two preload modules
 * (`correction.ts` + `correctionResult.ts`), both exported from the barrel.
 *
 * Validated in both directions: a malformed main-process reply is dropped
 * before it reaches React (mirroring `autocomplete.ts`'s `isSuggestReply`),
 * and a malformed outgoing payload is rejected here rather than trusting the
 * TypeScript parameter type, which only holds at compile time.
 */
import { ipcRenderer } from "electron";
import {
  normalizeAutocompleteSettings,
  type AutocompleteSettings,
} from "~/features/autocomplete/shared/autocompleteSettings";

/**
 * Field-by-field check, mirroring `~/features/ask/preload/ask.ts`: the shape
 * is small enough that widening any field to `unknown` would just move a
 * crash into React instead of preventing it.
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

export const autocompleteSettingsFeature = {
  /** A malformed main-process reply falls back to normalized defaults. */
  getAutocompleteSettings: async (): Promise<AutocompleteSettings> => {
    const result: unknown = await ipcRenderer.invoke(
      "get-autocomplete-settings",
    );
    return isAutocompleteSettings(result)
      ? result
      : normalizeAutocompleteSettings(undefined);
  },

  /**
   * Rejects a malformed payload before it ever reaches `ipcRenderer.invoke` —
   * the same shape the main-process handler validates independently, since
   * this boundary cannot trust its own caller's TypeScript types at runtime.
   */
  setAutocompleteSettings: async (
    settings: AutocompleteSettings,
  ): Promise<{ success: boolean }> => {
    if (!isAutocompleteSettings(settings)) {
      return { success: false };
    }
    return ipcRenderer.invoke("set-autocomplete-settings", settings);
  },
};

export type AutocompleteSettingsFeature = typeof autocompleteSettingsFeature;
