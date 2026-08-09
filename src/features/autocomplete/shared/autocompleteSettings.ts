/**
 * @file autocompleteSettings.ts
 * @description Autocomplete's stored settings shape and its normalizer.
 *
 * Electron-free — shared by main, preload, and renderer.
 */

export type AutocompleteSettings = {
  /** Absent or non-boolean reads as `false`; only a stored `true` enables. */
  enabled: boolean;
  /**
   * `""` means "use the Ask AI preset's model". Otherwise a composite model ref
   * (`<providerId>::<rawModelId>`).
   */
  model: string;
};

export const AUTOCOMPLETE_INHERIT_ASK_MODEL = "";

/**
 * Coerces stored JSON into {@link AutocompleteSettings}.
 *
 * Default-OFF lives here rather than in a migration pass: an install that has
 * never seen this feature stores nothing under `settingsAutocomplete`, so
 * `enabled` must read `false` from absent input — existing users must not be
 * upgraded into a paid autocomplete provider they never opted into. The ajv
 * `default` on the schema node cannot carry that alone — `useDefaults` injects
 * the *object* default only when the whole node is missing, so a stored object
 * that happens to omit just `enabled` would never receive it. This function is
 * the load-bearing one.
 *
 * Junk also reads as `false`, for the same reason: only an explicit `true`
 * turns the feature on.
 */
export const normalizeAutocompleteSettings = (raw: unknown): AutocompleteSettings => {
  const value = (raw ?? {}) as Partial<Record<keyof AutocompleteSettings, unknown>>;
  return {
    enabled: value.enabled === true,
    model: typeof value.model === "string" ? value.model.trim() : AUTOCOMPLETE_INHERIT_ASK_MODEL,
  };
};
