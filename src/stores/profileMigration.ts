/**
 * @file profileMigration.ts
 * @description Pure, store-free migration of an on-disk profile from the
 * retired single-provider `Profile.provider` shape to composite model refs
 * (`<providerId>::<rawModelId>`, see `~/shared/modelRef`). Testable without
 * electron-store — the store-facing driver (gated by `configVersion`) lives
 * in `apiStore.ts`.
 */
import { formatModelRef, isModelRef } from "~/shared/modelRef";
import {
  groupModelsByProvider,
  isProviderId,
  sanitizeEnabledProviders,
  type Model,
  type ProviderId,
} from "~/shared/providers";
import type { CorrectionPreset, Profile, SettingsStore } from "./apiStore";

/** Historical default for a profile carrying no `provider` key at all (D16). */
const LEGACY_DEFAULT_PROVIDER: ProviderId = "openrouter";

// ---------------------------------------------------------------------------
// Defensive narrowing over arbitrary on-disk JSON (F5).
//
// `migrateProfileForModelRefs` takes `unknown` but, pre-fix, assumed every
// nested shape was exactly what the current schema produces. In practice a
// stored profile can be anything `conf` last wrote — including shapes from a
// long-retired schema version, or (in tests) deliberately malformed fixtures.
// These helpers make every read total: unrecognized shapes degrade to an
// empty/neutral value instead of throwing, they never invent data.
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asObjectArray = (value: unknown): Record<string, unknown>[] =>
  asArray(value)
    .filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => entry as Record<string, unknown>);

/** Anything that isn't a string collapses to the empty "inherit" sentinel
 * rather than reaching `formatModelRef`/`isModelRef` as e.g. a bare number. */
const asModelIdString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Prefix a single stored model value: the empty inherit sentinel and an
 * already-prefixed ref both pass through untouched (this is what makes
 * repeated application a fixed point — D15a/D15b), everything else gets the
 * legacy provider prefixed on. Accepts `unknown` so every call site can pass
 * a raw, unvalidated on-disk value directly (F5) — a non-string value is
 * treated as the empty sentinel, never thrown on.
 */
const prefixModelRef = (legacyProvider: ProviderId, value: unknown): string => {
  const raw = asModelIdString(value);
  if (raw === "" || isModelRef(raw)) {
    return raw;
  }
  return formatModelRef(legacyProvider, raw);
};

/** True for a stored value that still needs `prefixModelRef` — non-empty and
 * not already a composite ref. Used only to decide whether a profile needs
 * migrating at all (F6); actual prefixing always goes through `prefixModelRef`
 * regardless of this check. */
const isBareModelValue = (value: unknown): boolean => {
  const raw = asModelIdString(value);
  return raw !== "" && !isModelRef(raw);
};

const migratePresets = (legacyProvider: ProviderId, value: unknown): CorrectionPreset[] =>
  asObjectArray(value).map(
    (preset) =>
      ({
        ...preset,
        model: prefixModelRef(legacyProvider, preset.model),
      }) as CorrectionPreset,
  );

/**
 * Prefix the retired flat, pre-presets `settingsCorrect.model` field
 * (`LegacyCorrectionSettings.model`) — a sixth model-bearing field, missed by
 * both the original card and its review (found by grepping the settings
 * shape per F12's own instruction). `normalizeCorrectionSettings` reads this
 * bare id straight off the raw `settingsCorrect` object whenever `presets`
 * isn't yet an array, the exact same way it reads `settingsTranslate.model`.
 */
const migrateSettingsCorrect = (
  legacyProvider: ProviderId,
  value: unknown,
): Record<string, unknown> => {
  const record = asRecord(value);
  const migrated: Record<string, unknown> = {
    ...record,
    presets: migratePresets(legacyProvider, record.presets),
  };
  if (typeof record.model === "string") {
    migrated.model = prefixModelRef(legacyProvider, record.model);
  }
  return migrated;
};

/**
 * Prefix the retired standalone-Translate settings' `model` field (F12).
 * `settingsTranslate` was removed from the typed `SettingsStore` shape (see
 * `apiStore.ts`), but upgrading users still carry it in the raw, on-disk
 * JSON — `extractLegacyTranslateSettings` reads it back out, and
 * `normalizeCorrectionSettings` re-injects its `model` as a bare id into the
 * Translate preset at read time, on a profile already marked migrated. Only
 * touches `model`; every other field round-trips untouched.
 */
const migrateLegacyTranslateSettings = (
  legacyProvider: ProviderId,
  value: unknown,
): Record<string, unknown> => {
  const record = asRecord(value);
  if (typeof record.model !== "string") {
    return record;
  }
  return { ...record, model: prefixModelRef(legacyProvider, record.model) };
};

/** The models a raw, unvalidated `settings.models` value actually names,
 * dropping anything that isn't itself a plain object (F5). */
const asModelsArray = (value: unknown): Model[] => asObjectArray(value) as Model[];

/**
 * The `enabledProviders` short-circuit that keeps the migration idempotent
 * (D15a/D15b) even though `legacyProvider` itself is NOT stable across
 * repeated calls (it falls back to "openrouter" the moment `provider` is
 * gone, i.e. after the first migration). Once a real, non-empty
 * `enabledProviders` is already on the settings, later calls just
 * re-sanitize it instead of recomputing from `legacyProvider` + the model
 * cache — recomputing would silently swap in the fallback legacy provider on
 * every subsequent call.
 *
 * That non-empty short-circuit alone is not enough (F6): a profile can have
 * an empty `enabledProviders` and still not be a legacy shape at all —
 * `createProfile()` yields exactly that (no `provider` key, `[]`), and its
 * emptiness means "no providers connected yet", not "unmigrated". `needsMigration`
 * disambiguates the two: it is true only when there is an actual legacy
 * `provider` field or an actual bare (un-prefixed) model id sitting somewhere
 * on the profile. When it is false, an empty `enabledProviders` is left
 * exactly as-is instead of being recomputed from the model cache — the
 * second pass stays genuinely inert, matching D15b's original claim.
 */
const resolveEnabledProviders = (
  legacyProvider: ProviderId,
  needsMigration: boolean,
  settings: Record<string, unknown>,
): ProviderId[] => {
  const existing = settings.enabledProviders;
  if (Array.isArray(existing) && existing.length > 0) {
    return sanitizeEnabledProviders(existing);
  }
  if (!needsMigration) {
    return sanitizeEnabledProviders(existing);
  }
  const models = asModelsArray(settings.models);
  const providersWithModels = groupModelsByProvider(models)
    .filter((group) => group.models.length > 0)
    .map((group) => group.provider);
  return sanitizeEnabledProviders([legacyProvider, ...providersWithModels]);
};

/**
 * Migrate a single raw, on-disk profile to the model-ref shape. Pure:
 * returns a new object, never mutates `profile` (`~/.claude/rules/common/coding-style.md`).
 * Total over `profile: unknown` (F5): every nested field is narrowed
 * defensively, so a malformed or historical on-disk shape degrades instead
 * of throwing from `initializeDefaultProfile`'s uncaught call site.
 *
 * Idempotent twice over, by construction: `prefixModelRef`'s `isModelRef`
 * short-circuit, and `resolveEnabledProviders`'s `needsMigration` gate —
 * both hold independently of any version marker the caller may track.
 */
export const migrateProfileForModelRefs = (profile: unknown): Profile => {
  const raw = asRecord(profile);
  const hasLegacyProviderField = isProviderId(raw.provider);
  const legacyProvider: ProviderId = isProviderId(raw.provider)
    ? raw.provider
    : LEGACY_DEFAULT_PROVIDER;

  const settings = asRecord(raw.settings);
  const settingsCorrect = asRecord(settings.settingsCorrect);
  const settingsPromptGen = asRecord(settings.settingsPromptGen);
  const settingsSummarize = asRecord(settings.settingsSummarize);
  const hasSettingsTranslate = "settingsTranslate" in settings;
  const settingsTranslate = settings.settingsTranslate;

  const rawPresets = asObjectArray(settingsCorrect.presets);
  const needsMigration =
    hasLegacyProviderField ||
    isBareModelValue(settings.selectedModel) ||
    isBareModelValue(settingsCorrect.model) ||
    isBareModelValue(settingsPromptGen.model) ||
    isBareModelValue(settingsSummarize.model) ||
    isBareModelValue(asRecord(settingsTranslate).model) ||
    rawPresets.some((preset) => isBareModelValue(preset.model));

  const migratedSettings = {
    ...settings,
    selectedModel: prefixModelRef(legacyProvider, settings.selectedModel),
    settingsCorrect: migrateSettingsCorrect(legacyProvider, settingsCorrect),
    settingsPromptGen: {
      ...settingsPromptGen,
      model: prefixModelRef(legacyProvider, settingsPromptGen.model),
    },
    settingsSummarize: {
      ...settingsSummarize,
      model: prefixModelRef(legacyProvider, settingsSummarize.model),
    },
    enabledProviders: resolveEnabledProviders(legacyProvider, needsMigration, settings),
    ...(hasSettingsTranslate
      ? { settingsTranslate: migrateLegacyTranslateSettings(legacyProvider, settingsTranslate) }
      : {}),
  } as SettingsStore;

  const { provider: _legacyProviderField, ...profileWithoutProvider } = raw;
  return {
    ...profileWithoutProvider,
    settings: migratedSettings,
  } as Profile;
};
