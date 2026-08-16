/**
 * @file presetOptions.ts
 * @description The one registry of per-preset extra options, plus the pure
 * functions that read it. A preset declares its own settings here as DATA —
 * key, choices, prompt fragments, i18n keys — so a future option on a future
 * preset is an entry in `PRESET_OPTION_DEFINITIONS` rather than another field
 * on `CorrectionPreset`, another sanitizer, another schema node and another
 * bespoke Settings control.
 *
 * Values are opaque strings on purpose: `CorrectionPreset.extraOptions` is
 * `Record<string, string>`, persisted in the same store as everything else,
 * and a string is the one shape that survives a hand edit, a profile export
 * and ajv's bare `{ type: "object" }` node without needing per-type handling.
 *
 * Imports nothing from `apiStore` — `apiStore` imports THIS — so the preset
 * argument is a structural `PresetWithOptions` rather than `CorrectionPreset`.
 */
import {
  DEFAULT_CAVEMAN_FULL_DIRECTIVE,
  DEFAULT_CAVEMAN_LITE_DIRECTIVE,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
} from "~/prompts/correction";

/** One selectable value of an option. */
export type PresetOptionChoice = {
  /** Persisted verbatim in `extraOptions`. Matched exactly — never trimmed or case-folded. */
  value: string;
  /** Appended to the preset's system prompt when this choice is the resolved one. */
  promptFragment: string;
  /**
   * i18n catalog key for this choice's label. Typed `string` rather than the
   * catalog's key union because the catalog entries land with the Settings
   * renderer; a union here would not compile until then.
   */
  labelKey: string;
};

/**
 * One option a preset declares. Everything a generic Settings control needs to
 * render the option lives here, so the renderer never learns a preset id.
 */
export type PresetOptionDefinition = {
  /** Key under `CorrectionPreset.extraOptions`. */
  key: string;
  /** i18n key for the control's label. */
  labelKey: string;
  /** i18n key for the explanatory line under the control. */
  hintKey: string;
  /** Choice used when nothing valid is stored. Must be one of `choices`. */
  defaultValue: string;
  /** Offered in array order. */
  choices: readonly PresetOptionChoice[];
};

/**
 * The structural slice of a preset these functions read. Keeps this module
 * free of an `apiStore` import, which would be circular.
 */
export type PresetWithOptions = {
  id: string;
  extraOptions?: Record<string, string>;
};

export const CAVEMAN_MODE_OPTION_KEY = "cavemanMode";

const CAVEMAN_MODE_OPTION: PresetOptionDefinition = {
  key: CAVEMAN_MODE_OPTION_KEY,
  labelKey: "settings.correction.option.cavemanMode.label",
  hintKey: "settings.correction.option.cavemanMode.hint",
  defaultValue: "full",
  choices: [
    {
      value: "lite",
      promptFragment: DEFAULT_CAVEMAN_LITE_DIRECTIVE,
      labelKey: "settings.correction.option.cavemanMode.lite",
    },
    {
      value: "full",
      promptFragment: DEFAULT_CAVEMAN_FULL_DIRECTIVE,
      labelKey: "settings.correction.option.cavemanMode.full",
    },
    {
      value: "ultra",
      promptFragment: DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
      labelKey: "settings.correction.option.cavemanMode.ultra",
    },
  ],
};

/**
 * Preset id → the options that preset declares. A `Map` rather than a plain
 * object because the lookup key is a stored preset id, i.e. user data:
 * `registry[id]` would answer `"toString"` or `"__proto__"` with an inherited
 * Object.prototype value instead of "this preset declares nothing".
 */
const PRESET_OPTION_DEFINITIONS: ReadonlyMap<
  string,
  readonly PresetOptionDefinition[]
> = new Map([[DEFAULT_CAVEMAN_PRESET_ID, [CAVEMAN_MODE_OPTION]]]);

// Frozen because it is a shared singleton: every preset that declares nothing
// gets this same array back, so one caller reaching past the `readonly` type
// would poison the answer for all of them.
const NO_OPTIONS: readonly PresetOptionDefinition[] = Object.freeze([]);

/** Total over `unknown`: any id that declared nothing answers `[]`. */
export const presetOptionDefinitions = (
  presetId: unknown,
): readonly PresetOptionDefinition[] =>
  typeof presetId === "string"
    ? (PRESET_OPTION_DEFINITIONS.get(presetId) ?? NO_OPTIONS)
    : NO_OPTIONS;

const isPlainRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * Own DATA properties only. An inherited value is not something the user
 * stored, and an accessor would run arbitrary code — from a JSON round trip
 * neither can happen, but this function's whole job is being total over what
 * a hand-edited or imported config can hold.
 */
const ownDataValue = (raw: Record<string, unknown>, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
};

const recognizedChoiceValue = (
  definition: PresetOptionDefinition,
  candidate: unknown,
): string | undefined =>
  typeof candidate === "string" &&
  definition.choices.some((choice) => choice.value === candidate)
    ? candidate
    : undefined;

/**
 * Narrows a stored `extraOptions` blob to the keys the preset declares, each
 * holding one of that option's declared values. An unknown preset id, an
 * unknown key and an unrecognized value are all dropped silently — this runs
 * on every config read, and a store built with `clearInvalidConfig: true` must
 * degrade a bad value rather than reject it.
 *
 * Returns `undefined`, never `{}`, when nothing survives, so a preset with no
 * options emits no `extraOptions` key at all after normalization.
 */
export const sanitizePresetOptions = (
  presetId: unknown,
  raw: unknown,
): Record<string, string> | undefined => {
  const definitions = presetOptionDefinitions(presetId);
  if (definitions.length === 0 || !isPlainRecord(raw)) return undefined;

  const sanitized: Record<string, string> = {};
  for (const definition of definitions) {
    const value = recognizedChoiceValue(
      definition,
      ownDataValue(raw, definition.key),
    );
    if (value !== undefined) sanitized[definition.key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const definitionFor = (
  presetId: string,
  optionKey: string,
): PresetOptionDefinition | undefined =>
  presetOptionDefinitions(presetId).find(
    (definition) => definition.key === optionKey,
  );

/**
 * The option's effective value: the stored choice when it is still one the
 * definition offers, the declared default otherwise. `undefined` means the
 * preset never declared that option — a different answer from "declared, but
 * unset", which is why this is not just a lookup with a `??`.
 */
export const resolvePresetOptionValue = (
  preset: PresetWithOptions,
  optionKey: string,
): string | undefined => {
  const definition = definitionFor(preset.id, optionKey);
  if (!definition) return undefined;

  const stored = preset.extraOptions
    ? ownDataValue(preset.extraOptions, optionKey)
    : undefined;

  return recognizedChoiceValue(definition, stored) ?? definition.defaultValue;
};

/**
 * Composes the selected options' prompt fragments onto a system prompt, in
 * registry order, trailing the preset's own instructions.
 *
 * Returns `systemPrompt` itself — same string, not an equal one — when the
 * preset declares no options. Every preset but the declaring one goes through
 * `fixGrammar`, so anything else here would silently move seven built-in
 * prompts and bust the providers' prompt cache for all of them.
 */
export const withPresetOptions = (
  systemPrompt: string,
  preset: PresetWithOptions,
): string => {
  const definitions = presetOptionDefinitions(preset.id);
  if (definitions.length === 0) return systemPrompt;

  const fragments = definitions.flatMap((definition) => {
    const value = resolvePresetOptionValue(preset, definition.key);
    const fragment = definition.choices
      .find((choice) => choice.value === value)
      ?.promptFragment.trim();
    return fragment ? [fragment] : [];
  });

  return fragments.length > 0
    ? [systemPrompt, ...fragments].join("\n\n")
    : systemPrompt;
};
