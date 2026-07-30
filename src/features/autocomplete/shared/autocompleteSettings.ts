/**
 * @file autocompleteSettings.ts
 * @description Autocomplete's stored settings shape and its normalizer.
 *
 * Electron-free — shared by main, preload, and renderer.
 */

export type AutocompleteSettings = {
  /** Absent or non-boolean reads as `true`; only a stored `false` disables. */
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
 * Default-ON lives here rather than in a migration pass: an install that has
 * never seen this feature stores nothing under `settingsAutocomplete`, so
 * `enabled` must read `true` from absent input. The ajv `default` on the schema
 * node cannot carry that alone — `useDefaults` injects the *object* default only
 * when the whole node is missing, so a stored object that happens to omit just
 * `enabled` would never receive it. This function is the load-bearing one.
 *
 * Junk also reads as `true`. The alternative — treating an unreadable value as
 * "off" — turns one corrupt write into a feature that is silently gone.
 */
export const normalizeAutocompleteSettings = (raw: unknown): AutocompleteSettings => {
  const value = (raw ?? {}) as Partial<Record<keyof AutocompleteSettings, unknown>>;
  return {
    enabled: value.enabled === false ? false : true,
    model: typeof value.model === "string" ? value.model.trim() : AUTOCOMPLETE_INHERIT_ASK_MODEL,
  };
};
