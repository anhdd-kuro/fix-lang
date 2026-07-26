/**
 * @file profileMigration.ts
 * @description Pure, store-free migration of an on-disk profile from the retired
 * single-provider `Profile.provider` shape to composite model refs. The
 * store-facing driver lives in `apiStore.ts`.
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

/** Historical default for a profile carrying no `provider` key at all. */
const LEGACY_DEFAULT_PROVIDER: ProviderId = "openrouter";

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asObjectArray = (value: unknown): Record<string, unknown>[] =>
  asArray(value)
    .filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => entry as Record<string, unknown>);

const asModelIdString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Prefix a stored model value with the legacy provider. The `isModelRef`
 * short-circuit is one of the two guards making the whole migration idempotent:
 * an already-prefixed ref passes through untouched.
 */
const prefixModelRef = (legacyProvider: ProviderId, value: unknown): string => {
  const raw = asModelIdString(value);
  if (raw === "" || isModelRef(raw)) {
    return raw;
  }
  return formatModelRef(legacyProvider, raw);
};

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
 * The retired flat `settingsCorrect.model` must be migrated too:
 * `normalizeCorrectionSettings` still reads it off the raw object whenever
 * `presets` isn't an array, so an unprefixed value would leak back in at read time.
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
 * `settingsTranslate` is off the typed shape but still on disk for upgrading
 * users, and `normalizeCorrectionSettings` re-injects its `model` into the
 * Translate preset at read time — so it needs prefixing like any other ref.
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

const asModelsArray = (value: unknown): Model[] => asObjectArray(value) as Model[];

/**
 * Never recompute `enabledProviders` from `legacyProvider` on an already-migrated
 * profile: `legacyProvider` falls back to "openrouter" once `provider` is gone, so
 * a second pass would silently swap that in. Both guards are needed — an empty
 * `enabledProviders` means "nothing connected yet" on a fresh `createProfile()`
 * profile, which `needsMigration` is what distinguishes from a legacy shape.
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
 * Migrate one raw on-disk profile to the model-ref shape. Must stay total over
 * `unknown` — the call site in `initializeDefaultProfile` does not catch, so a
 * malformed or historical shape has to degrade rather than throw.
 * Idempotence rests on two independent guards that hold with no version marker:
 * `prefixModelRef`'s `isModelRef` short-circuit and `resolveEnabledProviders`'s
 * `needsMigration` gate.
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
