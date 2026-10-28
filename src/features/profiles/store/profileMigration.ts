/**
 * @file profileMigration.ts
 * @description Pure, store-free migration of an on-disk profile from the retired
 * single-provider `Profile.provider` shape to composite model refs. The
 * store-facing driver lives in `apiStore.ts`.
 */
import { z } from "zod";
import {
  formatModelRef,
  isModelRef,
} from "~/features/providers/shared/modelRef";
import {
  groupModelsByProvider,
  isProviderId,
  sanitizeEnabledProviders,
  type Model,
  type ProviderId,
} from "~/features/providers/shared/providers";
import type {
  CorrectionPreset,
  Profile,
  SettingsStore,
} from "~/features/providers/store/apiStore";

/**
 * Any non-array, non-function object, copied key-for-key in its own order —
 * the same keys a spread would copy from a JSON-read value. Anything else
 * (`null`, a primitive, an array, a function) is not a record.
 */
const StoredRecordSchema = z.looseObject({});

type StoredRecord = z.infer<typeof StoredRecordSchema>;

/** Degrades a non-record to `{}` so the migration stays total over junk. */
const StoredRecordOrEmptySchema = StoredRecordSchema.catch(() => ({}));

const StoredArraySchema = z.array(z.unknown());

/** A non-string model value reads as "no model". */
const StoredModelIdSchema = z.string().catch("");

/**
 * `SettingsStore` plus the retired `settingsTranslate` bucket, which is off
 * the typed shape but still on disk for upgrading users.
 */
type MigratedSettingsStore = SettingsStore & {
  settingsTranslate?: StoredRecord;
};

/** Historical default for a profile carrying no `provider` key at all. */
const LEGACY_DEFAULT_PROVIDER: ProviderId = "openrouter";

/** Keeps the record entries of an array; a non-array reads as empty. */
const storedRecordEntries = (value: StoredRecord[string]): StoredRecord[] => {
  const array = StoredArraySchema.safeParse(value);
  if (!array.success) return [];
  return array.data.flatMap((entry) => {
    const record = StoredRecordSchema.safeParse(entry);
    return record.success ? [record.data] : [];
  });
};

/**
 * Prefix a stored model value with the legacy provider. The `isModelRef`
 * short-circuit is one of the two guards making the whole migration idempotent:
 * an already-prefixed ref passes through untouched.
 */
const prefixModelRef = (legacyProvider: ProviderId, raw: string): string => {
  if (raw === "" || isModelRef(raw)) {
    return raw;
  }
  return formatModelRef(legacyProvider, raw);
};

const prefixStoredModelRef = (
  legacyProvider: ProviderId,
  value: StoredRecord[string],
): string => prefixModelRef(legacyProvider, StoredModelIdSchema.parse(value));

const isBareModelValue = (value: StoredRecord[string]): boolean => {
  const raw = StoredModelIdSchema.parse(value);
  return raw !== "" && !isModelRef(raw);
};

const migratePresets = (
  legacyProvider: ProviderId,
  value: StoredRecord[string],
): CorrectionPreset[] =>
  storedRecordEntries(value).map(
    (preset) =>
      // SAFETY: only `model` is rewritten here; every other preset field is
      // carried over as stored, and `apiStore.set("profiles", …)` re-validates
      // the whole profile against `apiStoreSchema` before it is written back.
      ({
        ...preset,
        model: prefixStoredModelRef(legacyProvider, preset.model),
      }) as CorrectionPreset,
  );

/**
 * The retired flat `settingsCorrect.model` must be migrated too:
 * `normalizeCorrectionSettings` still reads it off the raw object whenever
 * `presets` isn't an array, so an unprefixed value would leak back in at read time.
 */
const migrateSettingsCorrect = (
  legacyProvider: ProviderId,
  record: StoredRecord,
): StoredRecord => {
  const migrated: StoredRecord = {
    ...record,
    presets: migratePresets(legacyProvider, record.presets),
  };
  const model = z.string().safeParse(record.model);
  if (model.success) {
    migrated.model = prefixModelRef(legacyProvider, model.data);
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
  record: StoredRecord,
): StoredRecord => {
  const model = z.string().safeParse(record.model);
  if (!model.success) {
    return record;
  }
  return { ...record, model: prefixModelRef(legacyProvider, model.data) };
};

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
  settings: StoredRecord,
): ProviderId[] => {
  const existing = settings.enabledProviders;
  const existingArray = StoredArraySchema.safeParse(existing);
  if (existingArray.success && existingArray.data.length > 0) {
    return sanitizeEnabledProviders(existingArray.data);
  }
  if (!needsMigration) {
    return sanitizeEnabledProviders(existing);
  }
  // SAFETY: `groupModelsByProvider` → `isModelForProvider` reads only
  // `model.provider` (strict equality / `=== undefined`) and `model.local`
  // (`!== undefined` / truthiness), both total over any record entry.
  const models = storedRecordEntries(settings.models) as Model[];
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
export const migrateProfileForModelRefs = <Input>(profile: Input): Profile => {
  const raw = StoredRecordOrEmptySchema.parse(profile);
  const hasLegacyProviderField = isProviderId(raw.provider);
  const legacyProvider: ProviderId = isProviderId(raw.provider)
    ? raw.provider
    : LEGACY_DEFAULT_PROVIDER;

  const settings = StoredRecordOrEmptySchema.parse(raw.settings);
  const settingsCorrect = StoredRecordOrEmptySchema.parse(
    settings.settingsCorrect,
  );
  const settingsPromptGen = StoredRecordOrEmptySchema.parse(
    settings.settingsPromptGen,
  );
  const settingsSummarize = StoredRecordOrEmptySchema.parse(
    settings.settingsSummarize,
  );
  const hasSettingsTranslate = "settingsTranslate" in settings;
  const settingsTranslate = StoredRecordOrEmptySchema.parse(
    settings.settingsTranslate,
  );

  const rawPresets = storedRecordEntries(settingsCorrect.presets);
  const needsMigration =
    hasLegacyProviderField ||
    isBareModelValue(settings.selectedModel) ||
    isBareModelValue(settingsCorrect.model) ||
    isBareModelValue(settingsPromptGen.model) ||
    isBareModelValue(settingsSummarize.model) ||
    isBareModelValue(settingsTranslate.model) ||
    rawPresets.some((preset) => isBareModelValue(preset.model));

  // SAFETY: only model-ref strings and `enabledProviders` are rewritten; the
  // rest is the stored settings as read, and `apiStore.set("profiles", …)`
  // re-validates the whole profile against `apiStoreSchema` before writing it.
  const migratedSettings: MigratedSettingsStore = {
    ...settings,
    selectedModel: prefixStoredModelRef(legacyProvider, settings.selectedModel),
    settingsCorrect: migrateSettingsCorrect(legacyProvider, settingsCorrect),
    settingsPromptGen: {
      ...settingsPromptGen,
      model: prefixStoredModelRef(legacyProvider, settingsPromptGen.model),
    },
    settingsSummarize: {
      ...settingsSummarize,
      model: prefixStoredModelRef(legacyProvider, settingsSummarize.model),
    },
    enabledProviders: resolveEnabledProviders(
      legacyProvider,
      needsMigration,
      settings,
    ),
  } as SettingsStore;
  if (hasSettingsTranslate) {
    migratedSettings.settingsTranslate = migrateLegacyTranslateSettings(
      legacyProvider,
      settingsTranslate,
    );
  }

  const { provider: _legacyProviderField, ...profileWithoutProvider } = raw;
  // SAFETY: same invariant as `migratedSettings` above — identity fields are
  // carried over as stored and `apiStoreSchema` re-validates on write.
  return {
    ...profileWithoutProvider,
    settings: migratedSettings,
  } as Profile;
};
