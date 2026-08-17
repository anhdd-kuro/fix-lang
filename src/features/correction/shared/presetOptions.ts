/**
 * @file presetOptions.ts
 * @description The one registry of per-preset ENUMERATED PROMPT-FRAGMENT
 * options, plus the pure functions that read it. A preset declares its own
 * settings here as DATA — key, choices, prompt fragments, i18n keys — so a
 * future option of that same shape is an entry in
 * `PRESET_OPTION_DEFINITIONS` rather than another field on `CorrectionPreset`,
 * another sanitizer, another schema node and another bespoke Settings control.
 *
 * WHAT THIS REGISTRY DOES NOT COVER, despite `extraOptions` being a general
 * `Record<string, string>`. Every option here is a closed set of choices, each
 * carrying a constant `promptFragment`, and `withPresetOptions` is the only
 * reader. So:
 *
 *   - A BEHAVIOURAL option ("also keep the original on the clipboard") has no
 *     prompt fragment. Modelled as a two-choice option it would persist,
 *     sanitize and render correctly and then be consumed by nothing — a
 *     working-looking control that does nothing. It needs its own consumer.
 *   - A FREE-FORM option ("max N words") has no enumerable choice list. It
 *     needs `PresetPromptOptionDefinition` to become a discriminated union,
 *     plus branches in `recognizedChoiceValue`, `withPresetOptions` and the
 *     Settings control.
 *
 * A boolean absorbs fine as a two-choice string; the two cases above do not.
 * Name the types honestly rather than let the file read as a home for any
 * per-preset setting.
 *
 * Values are opaque strings on purpose: `CorrectionPreset.extraOptions` is
 * `Record<string, string>`, persisted in the same store as everything else,
 * and a string is the one shape that survives a hand edit, a profile export
 * and the store's deliberately EMPTY `extraOptions` schema node without
 * needing per-type handling.
 */
import {
  DEFAULT_CAVEMAN_FULL_DIRECTIVE,
  DEFAULT_CAVEMAN_LITE_DIRECTIVE,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
} from "~/prompts/correction";
// Both `import type`, so both are erased at build time: `apiStore` importing
// this module back at RUNTIME is not a cycle.
import type { TranslationKey } from "~/features/i18n/shared/keys";
import type { CorrectionPreset } from "~/features/providers/store/apiStore";

/** One selectable value of an option. */
export type PresetPromptOptionChoice = {
  /** Persisted verbatim in `extraOptions`. Matched exactly — never trimmed or case-folded. */
  value: string;
  /** Appended to the preset's system prompt when this choice is the resolved one. */
  promptFragment: string;
  /** i18n catalog key for this choice's label. */
  labelKey: TranslationKey;
};

/**
 * One option a preset declares. Everything a generic Settings control needs to
 * render the option lives here, so the renderer never learns a preset id.
 *
 * `labelKey`/`hintKey` are `TranslationKey`, not `string`, so a renamed or
 * mistyped catalog key is a COMPILE error. `scripts/i18n-check.ts` reads only
 * the catalogs and never their usages, so a `string` here would let a rename
 * pass `bun run test` and `bun run i18n:check` alike and ship the raw key
 * text into the Settings dropdown.
 */
export type PresetPromptOptionDefinition = {
  /** Key under `CorrectionPreset.extraOptions`. */
  key: string;
  /** i18n key for the control's label. */
  labelKey: TranslationKey;
  /** i18n key for the explanatory line under the control. */
  hintKey: TranslationKey;
  /**
   * The CORRUPTION FALLBACK, not the product default. Every real profile has
   * the shipped value materialized into it by `makeDefaultCorrectionPresets()`,
   * so this fires only when a stored value was dropped as unrecognized — which
   * is exactly why it must EQUAL the shipped value. Editing it alone changes
   * nothing a user would ever see. The product default lives on the built-in
   * preset record in `apiStore.ts`; `presetOptions.test.ts` pins the two equal.
   */
  defaultValue: string;
  /** Offered in array order. */
  choices: readonly PresetPromptOptionChoice[];
};

export const CAVEMAN_MODE_OPTION_KEY = "cavemanMode";

const CAVEMAN_MODE_OPTION: PresetPromptOptionDefinition = {
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
 * Freezes a preset's definitions and everything reachable from them.
 *
 * `readonly` is a compile-time claim that is fully erased at runtime, so it
 * stops an honest caller and nobody else. These objects are a process-wide
 * singleton handed out by reference, and the choice objects carry the prompt
 * fragments that go to the model — so one in-place write anywhere (a `sort` or
 * a `reverse` that reads as pure is enough) substitutes a fragment, reorders
 * the dropdown or empties the registry for every later caller until the app
 * restarts, with no error and nothing to trace it back to.
 *
 * Applied to every registry entry rather than to the one that exists today, so
 * a future preset's options cannot ship unfrozen by omission.
 */
const frozenDefinitions = (
  definitions: readonly PresetPromptOptionDefinition[],
): readonly PresetPromptOptionDefinition[] =>
  Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        ...definition,
        choices: Object.freeze(
          definition.choices.map((choice) => Object.freeze({ ...choice })),
        ),
      }),
    ),
  );

/**
 * Preset id → the options that preset declares. A `Map` rather than a plain
 * object because the lookup key is a stored preset id, i.e. user data:
 * `registry[id]` would answer `"toString"` or `"__proto__"` with an inherited
 * Object.prototype value instead of "this preset declares nothing".
 */
const PRESET_OPTION_DEFINITIONS: ReadonlyMap<
  string,
  readonly PresetPromptOptionDefinition[]
> = new Map([
  [DEFAULT_CAVEMAN_PRESET_ID, frozenDefinitions([CAVEMAN_MODE_OPTION])],
]);

// Frozen for the same reason as the entries above, plus one of its own: every
// preset that declares nothing gets this same array back, so a single caller
// reaching past the `readonly` type would poison the answer for all of them.
const NO_OPTIONS: readonly PresetPromptOptionDefinition[] = Object.freeze([]);

/** Total over `unknown`: any id that declared nothing answers `[]`. */
export const presetOptionDefinitions = (
  presetId: unknown,
): readonly PresetPromptOptionDefinition[] =>
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
 *
 * "Total" here means total over every value JSON can produce, which is what
 * the only caller ever supplies. It is NOT total over every JS value: a
 * `Proxy` whose `getOwnPropertyDescriptor` trap throws propagates that
 * exception out of `sanitizePresetOptions`. Unreachable from `electron-store`
 * or a profile import, so it is documented rather than caught — a live JS
 * object reaching this function would be a new call site, and that call site
 * is the thing to reconsider.
 */
const ownDataValue = (raw: Record<string, unknown>, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
};

const recognizedChoiceValue = (
  definition: PresetPromptOptionDefinition,
  candidate: unknown,
): string | undefined =>
  typeof candidate === "string" &&
  definition.choices.some((choice) => choice.value === candidate)
    ? candidate
    : undefined;

/**
 * Narrows a stored `extraOptions` blob to the keys the preset declares, each
 * holding one of that option's declared values. An unknown preset id, an
 * unknown key, a non-object blob and an unrecognized value are all dropped
 * silently — this runs on every config read, and a store built with
 * `clearInvalidConfig: true` must degrade a bad value rather than reject it.
 * Rejecting in code here is precisely what lets the store's `extraOptions`
 * schema node stay EMPTY, which is what stops a hand edit from wiping every
 * profile.
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
): PresetPromptOptionDefinition | undefined =>
  presetOptionDefinitions(presetId).find(
    (definition) => definition.key === optionKey,
  );

/**
 * The option's effective value: the stored choice when it is still one the
 * definition offers, the declared default otherwise. `undefined` means the
 * preset never declared that option — a different answer from "declared, but
 * unset", which is why this is not just a lookup with a `??`.
 *
 * Takes a whole `CorrectionPreset` rather than a structural `{ id;
 * extraOptions? }`: `ComboStep` satisfies that structure, so a plausible
 * `resolvePresetOptionValue(step, key)` would compile and answer `undefined`
 * forever, because `step.id` is `"step-1"` and the preset id lives on
 * `step.presetId`. The import is `import type`, fully erased, so `apiStore`
 * importing this module back is not a cycle.
 */
export const resolvePresetOptionValue = (
  preset: CorrectionPreset,
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
  preset: CorrectionPreset,
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
