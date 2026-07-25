/**
 * @file profileMigration.ts
 * @description Pure, store-free migration of an on-disk profile from the
 * retired single-provider `Profile.provider` shape to composite model refs
 * (`<providerId>::<rawModelId>`, see `~/shared/modelRef`). Testable without
 * electron-store — the store-facing driver (gated by `configVersion`) lives
 * in `apiStore.ts`.
 */
import { formatModelRef, isModelRef } from "~/shared/modelRef";
import { isProviderId, sanitizeEnabledProviders, type ProviderId } from "~/shared/providers";
import type { CorrectionPreset, Profile, SettingsStore } from "./apiStore";

/** Historical default for a profile carrying no `provider` key at all (D16). */
const LEGACY_DEFAULT_PROVIDER: ProviderId = "openrouter";

/**
 * Prefix a single stored model value: the empty inherit sentinel and an
 * already-prefixed ref both pass through untouched (this is what makes
 * repeated application a fixed point — D15a/D15b), everything else gets the
 * legacy provider prefixed on.
 */
const prefixModelRef = (legacyProvider: ProviderId, value: string): string => {
  if (value === "" || isModelRef(value)) {
    return value;
  }
  return formatModelRef(legacyProvider, value);
};

const migratePreset =
  (legacyProvider: ProviderId) =>
  (preset: CorrectionPreset): CorrectionPreset => ({
    ...preset,
    model: prefixModelRef(legacyProvider, preset.model),
  });

/**
 * The `enabledProviders` short-circuit that keeps the migration idempotent
 * (D15a/D15b) even though `legacyProvider` itself is NOT stable across
 * repeated calls (it falls back to "openrouter" the moment `provider` is
 * gone, i.e. after the first migration). Once a real, non-empty
 * `enabledProviders` is already on the settings, later calls just
 * re-sanitize it instead of recomputing from `legacyProvider` + the model
 * cache — recomputing would silently swap in the fallback legacy provider on
 * every subsequent call. A freshly computed value is never empty (it always
 * contains at least `legacyProvider`), so "non-empty" cleanly distinguishes
 * "already migrated" from "never migrated" without an extra marker field.
 */
const resolveEnabledProviders = (
  legacyProvider: ProviderId,
  settings: SettingsStore,
): ProviderId[] => {
  const existing = settings.enabledProviders;
  if (Array.isArray(existing) && existing.length > 0) {
    return sanitizeEnabledProviders(existing);
  }
  const models = settings.models ?? [];
  return sanitizeEnabledProviders([legacyProvider, ...models.map((model) => model.provider)]);
};

/**
 * Migrate a single raw, on-disk profile to the model-ref shape. Pure:
 * returns a new object, never mutates `profile` (`~/.claude/rules/common/coding-style.md`).
 *
 * Idempotent twice over, by construction: `prefixModelRef`'s `isModelRef`
 * short-circuit, and `resolveEnabledProviders`'s non-empty short-circuit —
 * both hold independently of any version marker the caller may track.
 */
export const migrateProfileForModelRefs = (profile: unknown): Profile => {
  const raw = profile as Profile & { provider?: unknown };
  const legacyProvider: ProviderId = isProviderId(raw.provider)
    ? raw.provider
    : LEGACY_DEFAULT_PROVIDER;

  const settings = raw.settings;

  const migratedSettings: SettingsStore = {
    ...settings,
    selectedModel: prefixModelRef(legacyProvider, settings.selectedModel),
    settingsCorrect: {
      ...settings.settingsCorrect,
      presets: settings.settingsCorrect.presets.map(migratePreset(legacyProvider)),
    },
    settingsPromptGen: {
      ...settings.settingsPromptGen,
      model: prefixModelRef(legacyProvider, settings.settingsPromptGen.model),
    },
    settingsSummarize: {
      ...settings.settingsSummarize,
      model: prefixModelRef(legacyProvider, settings.settingsSummarize.model),
    },
    enabledProviders: resolveEnabledProviders(legacyProvider, settings),
  };

  const { provider: _legacyProviderField, ...profileWithoutProvider } = raw;
  return {
    ...profileWithoutProvider,
    settings: migratedSettings,
  };
};
