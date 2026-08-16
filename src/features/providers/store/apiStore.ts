/**
 * @file store.ts
 * @description Electron Store schema, types, and initialization for settings and key bindings.
 */
import Store from "electron-store";
import { DEFAULT_LANGUAGE, resolveDefaultModel } from "~/const";
import {
  AUTOCOMPLETE_INHERIT_ASK_MODEL,
  DEFAULT_DAILY_COST_CAP_USD,
  normalizeAutocompleteSettings,
  type AutocompleteSettings,
} from "~/features/autocomplete/shared/autocompleteSettings";
// Runtime import, but no cycle: `comboValidation` takes only TYPES from this
// module (`ComboPreset`, `CorrectionPreset`), which are erased.
import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
// Runtime import, but no cycle: `presetOptions` is pure data plus pure
// functions and imports only `~/prompts/correction`.
import {
  CAVEMAN_MODE_OPTION_KEY,
  sanitizePresetOptions,
} from "~/features/correction/shared/presetOptions";
import {
  DEFAULT_REASONING_EFFORT,
  sanitizeReasoningEffort,
  type ReasoningEffort,
} from "~/features/correction/shared/reasoningEffort";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { migrateProfileForModelRefs } from "~/features/profiles/store/profileMigration";
import { sanitizeBedrockRegion } from "~/features/providers/shared/bedrockEndpoint";
import {
  sanitizeProviderEndpoint,
  type ProviderEndpoint,
} from "~/features/providers/shared/lmstudioEndpoint";
import { modelRefForModel, parseModelRef } from "~/features/providers/shared/modelRef";
import { sanitizeOpenAIProjectId } from "~/features/providers/shared/openaiProject";
import {
  isModelForProvider,
  isProviderId,
  PROVIDER_IDS,
  sanitizeEnabledProviders,
  type Model,
  type ProviderId,
} from "~/features/providers/shared/providers";
// Runtime import, but no cycle: `keybindingStore` takes only a TYPE from this
// module, which is erased.
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_ASK_PRESET_PROMPT,
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_PRESET_PROMPT,
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_CUSTOM_PROMPT,
  DEFAULT_PERFECT_PROMPT_COMBO_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
  DEFAULT_SUMMARIZE_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_PROMPT,
  DEFAULT_TRANSLATE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_PROMPT,
} from "~/prompts";
import type { Schema } from "electron-store";

// Re-exported for existing importers; `~/features/providers/shared/providers` is the source of truth.
export { isModelForProvider, isProviderId, PROVIDER_IDS };
export type { Model, ProviderId };

export type ProviderEndpointMap = Partial<Record<ProviderId, { host: string; port: number }>>;



export const sanitizeProviderEndpoints = (raw: unknown): ProviderEndpointMap => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: ProviderEndpointMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isProviderId(key)) continue;
    // Local OpenAI-compatible / Ollama daemons persist host:port.
    if (key === "bedrock") {
      const region = sanitizeBedrockRegion(
        typeof value === "object" && value !== null && "host" in value
          ? (value as { host: unknown }).host
          : value,
      );
      if (region) result[key] = { host: region, port: 0 };
      continue;
    }
    if (key !== "lmstudio" && key !== "ollama") continue;
    const endpoint = sanitizeProviderEndpoint(value);
    if (endpoint) result[key] = endpoint;
  }
  return result;
};

export const getProviderEndpoint = (
  provider: ProviderId,
  endpoints?: ProviderEndpointMap | null,
): ProviderEndpoint | undefined => {
  const map = endpoints ?? sanitizeProviderEndpoints(getProfileSetting("providerEndpoints"));
  return map[provider];
};


export type KeyBindings = {
  promptGen: string; // generate a new prompt based on current selection
  profileSwitch: string; // switch to next profile in rotation
};

export type CorrectionPreset = {
  id: string;
  name: string;
  hotkey: string;
  systemPrompt: string;
  model: string;
  isBuiltIn: boolean;
  /**
   * Optional per-preset AI SDK `reasoning` effort. Undefined omits the parameter
   * (provider-default). Slider steps: low → medium → high.
   */
  reasoning?: ReasoningEffort;
  /**
   * The hotkey opens an input window and carries the selection as optional
   * context, instead of aborting when nothing is selected. Undefined behaves as
   * false (the outbound-polish flow every other built-in uses).
   */
  requiresInput?: boolean;
  /**
   * Per-preset override of the global correction output mode. "inherit" (and
   * undefined) defers to the global setting at request time. The union is
   * written out here rather than imported so `apiStore` — which nearly every
   * module reaches — keeps no dependency on the renderer-side helper module.
   */
  outputMode?: "inherit" | "paste" | "popup";
  /** Render the result as GFM markdown rather than plain text. */
  markdownOutput?: boolean;
  /**
   * Options this preset declares for itself, keyed by option key. Which keys
   * and which values are legal is DATA, held by the option registry in
   * `~/features/correction/shared/presetOptions` — not by this type, not by
   * the schema, and not by the Settings renderer. A preset that declares no
   * options carries no key at all here.
   *
   * Values are opaque strings on purpose: they survive a hand edit, a profile
   * export and the bare `{ type: "object" }` schema node without per-type
   * handling, and `sanitizePresetOptions` is what turns them back into
   * something meaningful.
   */
  extraOptions?: Record<string, string>;
};

const sanitizePresetOutputMode = (
  raw: unknown,
): CorrectionPreset["outputMode"] =>
  raw === "inherit" || raw === "paste" || raw === "popup" ? raw : undefined;

const sanitizeBoolean = (raw: unknown): boolean | undefined =>
  typeof raw === "boolean" ? raw : undefined;

/** One node in a Combo chain. Text in, text out — always. */
export type ComboStep = {
  /** Stable id. Survives reorder; keys the UI row and the per-step log line. */
  id: string;
  presetId: string;
  /**
   * Frozen stand-in for the question a `requiresInput` preset would have
   * prompted for. A Combo never opens the Ask input window, so a step whose
   * preset has `requiresInput` is invalid without this.
   */
  inlineInput?: string;
};

export type ComboPreset = {
  id: string;
  name: string;
  hotkey: string;
  /** Execution order IS array order. No `order` field — one source of truth. */
  steps: ComboStep[];
  /** Combo-level only. Step presets' own outputMode is ignored. */
  outputMode?: "inherit" | "paste" | "popup";
  /** Applies to the FINAL step's output only. */
  markdownOutput?: boolean;
  schemaVersion: 1;
};

export type CorrectionSettings = {
  presets: CorrectionPreset[];
  selectedPresetId: string;
  /** Absent reads as []. That is the whole migration. */
  combos?: ComboPreset[];
};

// A missing id is materialized (never fatal) so one unusable field can't
// shorten the chain the user configured. But `step-${index + 1}` collides
// once any earlier step in the same combo already holds that id — explicitly
// stored or materialized the same way. Bump with a numeric suffix until the
// candidate is unique within `seenStepIds`, mirroring the top-level
// `seenIds` dedup `sanitizeCombos` already does across combos, and record
// the winner so later steps see it as taken too. A collision must resolve
// to a distinct id, never a dropped step.
const resolveUniqueStepId = (candidateId: string, seenStepIds: Set<string>): string => {
  if (!seenStepIds.has(candidateId)) return candidateId;

  let suffix = 2;
  let bumped = `${candidateId}-${suffix}`;
  while (seenStepIds.has(bumped)) {
    suffix += 1;
    bumped = `${candidateId}-${suffix}`;
  }
  return bumped;
};

const sanitizeComboStep = (
  raw: unknown,
  index: number,
  seenStepIds: Set<string>,
): ComboStep | null => {
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as Record<string, unknown>;
  const presetId =
    typeof candidate.presetId === "string" ? candidate.presetId.trim() : "";
  if (!presetId) return null;

  const storedId = typeof candidate.id === "string" ? candidate.id.trim() : "";
  // Kept verbatim: it is free text the model receives. Whitespace-only is a
  // validation error (`validateCombo`), not something to silently rewrite.
  const inlineInput =
    typeof candidate.inlineInput === "string" ? candidate.inlineInput : undefined;

  const id = resolveUniqueStepId(storedId || `step-${index + 1}`, seenStepIds);
  seenStepIds.add(id);

  return {
    id,
    presetId,
    ...(inlineInput !== undefined ? { inlineInput } : {}),
  };
};

const sanitizeCombo = (raw: unknown): ComboPreset | null => {
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!id || !name || !Array.isArray(candidate.steps)) return null;

  // One unusable step invalidates the whole chain: dropping just that step
  // would run a SHORTER combo than the user configured, silently.
  const steps: ComboStep[] = [];
  const seenStepIds = new Set<string>();
  for (const [index, rawStep] of candidate.steps.entries()) {
    const step = sanitizeComboStep(rawStep, index, seenStepIds);
    if (!step) return null;
    steps.push(step);
  }

  const outputMode = sanitizePresetOutputMode(candidate.outputMode);
  const markdownOutput = sanitizeBoolean(candidate.markdownOutput);

  return {
    id,
    name,
    // Never rewritten here, not even onto a hotkey some preset or app binding
    // already holds: every accelerator in the app shares one registration
    // space, and resolving a collision across all of them is the pre-save
    // `validateHotkeys` gate's job, not the sanitizer's.
    hotkey: typeof candidate.hotkey === "string" ? candidate.hotkey.trim() : "",
    steps,
    ...(outputMode !== undefined ? { outputMode } : {}),
    ...(markdownOutput !== undefined ? { markdownOutput } : {}),
    // Lazy upgrade on read. `1` is the only version the union admits today, so
    // an absent or unrecognized value normalizes rather than costing the user
    // the combo; a future version 2 branches here.
    schemaVersion: 1,
  };
};

/**
 * Materializes a built-in combo the stored config does not have, exactly the
 * way `normalizeCorrectionSettings` materializes a missing built-in preset:
 * matched by id, stored entry always wins, defaults emitted first.
 *
 * Existing profiles predate the combo, so without this it would only ever reach
 * fresh installs — the stored `combos: []` is a real value and
 * `getDefaultCorrectionSettings` never runs against it.
 *
 * Consequence worth stating rather than hiding: a user who DELETES the built-in
 * combo gets it back on the next load. That is the same bargain built-in
 * presets already make (delete Summarize and it returns), so this follows the
 * app's existing rule rather than inventing a second one — but it does mean
 * "delete" means "reset" for this row, and emptying its steps is not an option
 * either, since `validateCombo` refuses a combo under two steps.
 */
const withDefaultCombos = (stored: ComboPreset[]): ComboPreset[] => {
  const defaults = makeDefaultCombos();
  const defaultIds = new Set(defaults.map((combo) => combo.id));

  return [
    ...defaults.map(
      (defaultCombo) =>
        stored.find((combo) => combo.id === defaultCombo.id) ?? defaultCombo,
    ),
    ...stored.filter((combo) => !defaultIds.has(combo.id)),
  ];
};

const sanitizeCombos = (raw: unknown): ComboPreset[] => {
  if (!Array.isArray(raw)) return [];

  const seenIds = new Set<string>();
  return raw.flatMap((entry) => {
    const combo = sanitizeCombo(entry);
    if (!combo || seenIds.has(combo.id)) return [];
    seenIds.add(combo.id);
    return [combo];
  });
};

/**
 * Profile to store and switch between different application settings
 */
export type Profile = {
  id: string; // UUID
  name: string;
  description?: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  settings: SettingsStore;
};

export type SettingsStore = {
  // Core API settings
  /** @deprecated Legacy plaintext value. It is scrubbed on import/export and migrated to safeStorage. */
  apiKey: string;
  models: Model[];
  selectedModel: string;
  enabledProviders: ProviderId[];
  /** Per-provider host/port. Used by LM Studio and Ollama local daemons. */
  providerEndpoints: ProviderEndpointMap;
  /**
   * OpenAI project whose spend the tray's Providers card reports. Not
   * discoverable from the admin key (organization-scoped), so the user supplies
   * it. Empty means "not configured".
   */
  openaiProjectId?: string;
  /** Profile-wide default reasoning effort; presets inherit when unset. */
  defaultReasoningEffort?: ReasoningEffort;

  // Feature-specific settings
  settingsCorrect: CorrectionSettings;
  settingsSummarize: {
    minLength: number;
    maxLength: number;
    model: string;
    targetLanguage: string;
  };
  settingsPromptGen: {
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    autoCopy: boolean;
    model: string;
  };
  /**
   * Profile-scoped, not global: a model ref names a provider, and providers are
   * connected per profile. A global ref could point at a provider the active
   * profile never connected, so `resolveModelRef` would return null and every
   * keystroke would fail.
   */
  settingsAutocomplete: AutocompleteSettings;

  // Profiles
  profiles: Profile[];
  currentProfileId: string;

  // Legacy fields (for backward compatibility)
  customSystemPrompt: string;
  customUserPrompt: string;
  tone: string;
};

type LegacyCorrectionSettings = {
  paraphrase?: boolean;
  withShorten?: boolean;
  paraphrasePrompt?: string;
  userInput?: string;
  model?: string;
};

/**
 * Shape of the retired standalone-Translate feature's settings, carried over
 * when an existing user upgrades to the preset-based model. All fields optional
 * because legacy stores may be partial.
 */
export type LegacyTranslateSettings = {
  destinationLang?: string;
  includeExplanation?: boolean;
  model?: string;
  // Deliberately carries NO `hotkey`. The migration below runs after the
  // anti-theft guard in `normalizeCorrectionSettings`, so an accelerator
  // plumbed in here would rewrite the Translate preset's hotkey onto a key a
  // stored preset already claims — the exact steal that guard prevents. The old
  // `keyBindings.translate` value was never read into this shape anyway.
};

/**
 * Build the system prompt for a migrated Translate preset: the bundled JP↔EN
 * prompt, augmented with the user's legacy target language / explanation
 * preference so their configured behavior is preserved on upgrade.
 */
const buildMigratedTranslatePrompt = (
  legacy: LegacyTranslateSettings,
): string => {
  const base = DEFAULT_TRANSLATE_PRESET_PROMPT.trim();
  const destinationLang = legacy.destinationLang?.trim();
  if (!destinationLang) {
    return base;
  }
  const explanation = legacy.includeExplanation
    ? " Include a brief explanation of the translation."
    : "";
  return `${base}\n\nPreferred target language: ${destinationLang}.${explanation}`;
};

/**
 * Apply retired standalone-Translate settings onto the Translate preset.
 * Only runs when the stored config did NOT already contain a Translate preset
 * (i.e. a genuine pre-preset upgrade) so it never clobbers a user-customized one.
 */
const applyLegacyTranslateMigration = (
  presets: CorrectionPreset[],
  legacy: LegacyTranslateSettings | undefined,
  storedHadTranslatePreset: boolean,
): CorrectionPreset[] => {
  const hasLegacyData =
    !!legacy &&
    (!!legacy.destinationLang?.trim() ||
      !!legacy.model?.trim() ||
      legacy.includeExplanation === true);

  if (storedHadTranslatePreset || !hasLegacyData || !legacy) {
    return presets;
  }

  // Model and prompt only — the hotkey stays whatever the merge decided, so this
  // pass cannot undo the anti-theft guard that already ran on it.
  return presets.map((preset) =>
    preset.id === DEFAULT_TRANSLATE_PRESET_ID
      ? {
          ...preset,
          model: legacy.model?.trim() || preset.model,
          systemPrompt: buildMigratedTranslatePrompt(legacy),
        }
      : preset,
  );
};

// An empty preset model means "inherit the global default model" — resolved
// dynamically (latest GPT mini) at request/display time via getDefaultModelId.
const INHERIT_GLOBAL_MODEL = "";

const makeDefaultCorrectionPresets = (): CorrectionPreset[] => [
  {
    id: DEFAULT_CORRECTION_PRESET_ID,
    name: "Correction",
    hotkey: "Control+Shift+F",
    systemPrompt: DEFAULT_CUSTOM_PROMPT.trim(),
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
  },
  {
    id: DEFAULT_SUMMARIZE_PRESET_ID,
    name: "Summarize",
    hotkey: "Control+Shift+S",
    systemPrompt: DEFAULT_SUMMARIZE_PRESET_PROMPT,
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
  },
  {
    id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
    name: "Prompt optimization",
    hotkey: "Control+Shift+D",
    systemPrompt: DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
    reasoning: "low",
  },
  {
    id: DEFAULT_TRANSLATE_PRESET_ID,
    name: "Translate",
    hotkey: "Control+Shift+T",
    systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT.trim(),
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
  },
  {
    id: DEFAULT_BUSINESS_WRITING_PRESET_ID,
    name: "Business Writing",
    hotkey: "Control+Shift+B",
    systemPrompt: DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
    reasoning: "low",
  },
  {
    id: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    name: "Context-Aware Structured Text",
    hotkey: "Control+Shift+R",
    systemPrompt: DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
  },
  {
    id: DEFAULT_ASK_PRESET_ID,
    name: "Ask AI",
    hotkey: "Control+Shift+A",
    systemPrompt: DEFAULT_ASK_PRESET_PROMPT,
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
    // `minimal` was retired; RETIRED_EFFORTS remaps a STORED one to `low`, but
    // a fresh default must not ship a retired value — it is not in the
    // `ReasoningEffort` union, so it no longer type-checks either.
    reasoning: "low",
    requiresInput: true,
    outputMode: "popup",
    markdownOutput: true,
  },
  {
    // APPENDED, never inserted: every index into this array that a stored
    // profile, a combo step or a test already relies on stays where it was.
    id: DEFAULT_CAVEMAN_PRESET_ID,
    name: "Caveman",
    // `Control+Shift+C` is free against the seven defaults above, both app
    // bindings in `DEFAULT_KEY_BINDINGS`, `COMBO_CANCEL_ACCELERATOR` and
    // devtools' F12. A USER may still hold it, and this default gives way
    // rather than stealing it — see `withoutStolenHotkey` below.
    hotkey: "Control+Shift+C",
    systemPrompt: DEFAULT_CAVEMAN_PRESET_PROMPT,
    model: INHERIT_GLOBAL_MODEL,
    isBuiltIn: true,
    // The one built-in that declares a preset option. Materialized here rather
    // than left to `resolvePresetOptionValue`'s default so the value the user
    // will see in Settings is the value stored in their profile from day one.
    extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "full" },
  },
];

/**
 * Ships one combo: Correction, then Context-Aware Structured Text, then Prompt
 * optimization — clean the text, give it structure, then turn it into a prompt.
 *
 * **It ships with NO hotkey, and that is the point.** Every other built-in
 * binding is one AI call; this one is three, on whatever models those presets
 * resolve to. A default accelerator would also have to survive collision with
 * whatever the user has already claimed, and the combo normalizer has no
 * equivalent of the presets' `hotkeysClaimedByStoredPresets` yielding rule — so
 * a chord chosen here could silently outrank a stored preset's and leave one of
 * the two unregistered. The user assigns one in Settings → Combos.
 *
 * `outputMode` is left off (inherit) rather than pinned to `popup`: the last
 * step's output is a prompt to paste somewhere, and which way the user wants
 * that delivered is already a setting they have made.
 */
const makeDefaultCombos = (): ComboPreset[] => [
  {
    id: DEFAULT_PERFECT_PROMPT_COMBO_ID,
    name: "Perfect prompt",
    hotkey: "",
    steps: [
      {
        id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-1`,
        presetId: DEFAULT_CORRECTION_PRESET_ID,
      },
      {
        id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-2`,
        presetId: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
      },
      {
        id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-3`,
        presetId: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
      },
    ],
    schemaVersion: 1,
  },
];

export const getDefaultCorrectionSettings = (): CorrectionSettings => ({
  presets: makeDefaultCorrectionPresets(),
  selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
  // Present rather than absent so every reader of a normalized
  // `settingsCorrect` can index it without a guard.
  combos: makeDefaultCombos(),
});

const buildLegacyCorrectionPrompt = (
  legacy: LegacyCorrectionSettings,
): string => {
  const sections = [legacy.userInput?.trim() || DEFAULT_CUSTOM_PROMPT.trim()];

  if (legacy.paraphrasePrompt?.trim()) {
    sections.push(legacy.paraphrasePrompt.trim());
  }

  return sections.join("\n\n");
};

/**
 * The app-level accelerators `registerCorrectionShortcut` treats as reserved.
 * Read through a defaulted parameter rather than inline so tests can drive a
 * remapped binding without reaching into `keybindingStore`, while no call site
 * can forget to supply it and silently lose the guard below.
 *
 * `COMBO_CANCEL_ACCELERATOR` (`Control+Escape`) is included unconditionally,
 * not just when `promptGen`/`profileSwitch` happen to collide (design C6,
 * closing V2) — unlike the app bindings, it is not user-remappable, so it
 * belongs in the base list rather than behind a caller-supplied override. A
 * STORED preset hotkey on that chord is still never rewritten here; that stays
 * `validateHotkeys`' pre-save job and `registerCorrectionShortcut`'s
 * migration-path skip. Exported for direct assertion in
 * `normalizeCorrectionSettings.test.ts` — no built-in default currently sits
 * on this chord, so the effect is otherwise unobservable end-to-end.
 */
export const readReservedAppAccelerators = (): readonly string[] => {
  const { promptGen, profileSwitch } = keybindingStore.getKeyBindings();

  return [promptGen, profileSwitch, COMBO_CANCEL_ACCELERATOR];
};

export const normalizeCorrectionSettings = (
  value: unknown,
  legacyTranslate?: LegacyTranslateSettings,
  reservedAppAccelerators: readonly string[] = readReservedAppAccelerators(),
): CorrectionSettings => {
  const defaults = getDefaultCorrectionSettings();
  const defaultById = new Map(
    defaults.presets.map((preset) => [preset.id, preset]),
  );

  // `registerCorrectionShortcut` skips a preset hotkey equal to `promptGen` or
  // `profileSwitch` with nothing but a warn. A default materialized onto a
  // REMAPPED app binding would therefore show in Settings as an assigned hotkey
  // that can never fire, so a default gives its hotkey up here instead. Only
  // default-sourced hotkeys: a STORED one is the user's explicit choice and
  // stays put, same rule as the stolen-hotkey guard further down.
  const reservedAccelerators = new Set(
    reservedAppAccelerators
      .map((accelerator) => accelerator.trim())
      .filter((accelerator) => accelerator.length > 0),
  );
  const withoutReservedHotkey = (preset: CorrectionPreset): CorrectionPreset =>
    reservedAccelerators.has(preset.hotkey.trim())
      ? { ...preset, hotkey: "" }
      : preset;

  if (!value || typeof value !== "object") {
    return {
      ...defaults,
      presets: applyLegacyTranslateMigration(
        defaults.presets.map(withoutReservedHotkey),
        legacyTranslate,
        false,
      ),
    };
  }

  const raw = value as Partial<CorrectionSettings> & LegacyCorrectionSettings;

  const combos = withDefaultCombos(sanitizeCombos(raw.combos));

  const storedHadTranslatePreset =
    Array.isArray(raw.presets) &&
    raw.presets.some(
      (preset) =>
        !!preset &&
        typeof preset === "object" &&
        (preset as Partial<CorrectionPreset>).id === DEFAULT_TRANSLATE_PRESET_ID,
    );

  const getTrimmedString = (candidate: unknown): string | undefined => {
    return typeof candidate === "string" ? candidate.trim() : undefined;
  };

  if (!Array.isArray(raw.presets)) {
    const migratedCorrectionPreset = {
      ...defaults.presets[0],
      systemPrompt: buildLegacyCorrectionPrompt(raw),
      model: raw.model?.trim() || defaults.presets[0].model,
    } satisfies CorrectionPreset;

    // Return all built-in defaults; only the correction preset gets the migrated prompt.
    // Using slice(1) ensures summarize, prompt-optimization, and translate are all included.
    return {
      presets: applyLegacyTranslateMigration(
        [migratedCorrectionPreset, ...defaults.presets.slice(1)].map(
          withoutReservedHotkey,
        ),
        legacyTranslate,
        false,
      ),
      selectedPresetId: migratedCorrectionPreset.id,
      combos,
    };
  }

  const seenIds = new Set<string>();
  const normalizedEntries = raw.presets.flatMap((preset, index) => {
    if (!preset || typeof preset !== "object") {
      return [];
    }

    const candidate = preset as Partial<CorrectionPreset>;
    const fallback = defaultById.get(candidate.id?.trim() || "");
    const id = candidate.id?.trim() || `preset-${index + 1}`;

    if (seenIds.has(id)) {
      return [];
    }

    seenIds.add(id);

    // Existing profiles predate the two built-in Low defaults. Migrate
    // only those recognized built-ins when the field is absent; explicit
    // stored values still win, and unknown values are still dropped.
    const rawCandidate = candidate as Record<string, unknown>;
    const reasoning =
      rawCandidate.reasoning === undefined &&
      fallback !== undefined &&
      (id === DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID ||
        id === DEFAULT_BUSINESS_WRITING_PRESET_ID)
        ? "low"
        : sanitizeReasoningEffort(rawCandidate.reasoning);

    // `requiresInput` is structural, not a preference: it decides whether the
    // hotkey opens an input window or aborts on an empty selection, and no UI
    // exposes it. A recognized built-in therefore takes the default's value
    // even when the stored row carries its own, so a row that predates (or
    // lost) the flag cannot leave Ask permanently behaving like Correction.
    // Only a non-built-in falls back to whatever boolean was stored.
    const requiresInput = fallback
      ? fallback.requiresInput
      : sanitizeBoolean(rawCandidate.requiresInput);

    // These two ARE user preferences, so a recognized stored value wins. An
    // unrecognized or absent one falls back to the built-in default — the same
    // rule `name`/`hotkey`/`systemPrompt`/`model` follow above — which is what
    // keeps a legacy or corrupted value from silently turning Ask's markdown
    // popup into a plain-text paste.
    const outputMode =
      sanitizePresetOutputMode(rawCandidate.outputMode) ?? fallback?.outputMode;
    const markdownOutput =
      sanitizeBoolean(rawCandidate.markdownOutput) ?? fallback?.markdownOutput;

    // No `?? fallback?.extraOptions`, unlike the two above: which options exist
    // is keyed off the preset ID inside the sanitizer, so a stored value that
    // was dropped was dropped because the registry does not recognize it — and
    // the built-in's own value would be just as unrecognized. Absent means
    // "use the registry default", which `resolvePresetOptionValue` supplies at
    // read time, so nothing has to be materialized here.
    const extraOptions = sanitizePresetOptions(id, rawCandidate.extraOptions);

    return [
      {
        preset: {
          id,
          name:
            candidate.name?.trim() || fallback?.name || `Preset ${index + 1}`,
          hotkey: getTrimmedString(candidate.hotkey) ?? fallback?.hotkey ?? "",
          systemPrompt:
            candidate.systemPrompt?.trim() ||
            fallback?.systemPrompt ||
            DEFAULT_CUSTOM_PROMPT.trim(),
          // Empty stays empty (inherit global). A stored explicit model is kept
          // as-is; only the built-in fallback is consulted, never the const.
          model:
            candidate.model?.trim() || fallback?.model || INHERIT_GLOBAL_MODEL,
          isBuiltIn: fallback ? true : Boolean(candidate.isBuiltIn),
          ...(reasoning !== undefined ? { reasoning } : {}),
          ...(requiresInput !== undefined ? { requiresInput } : {}),
          ...(outputMode !== undefined ? { outputMode } : {}),
          ...(markdownOutput !== undefined ? { markdownOutput } : {}),
          ...(extraOptions !== undefined ? { extraOptions } : {}),
        } satisfies CorrectionPreset,
        // A missing or non-string `hotkey` above inherits the built-in default.
        // That injected value is not the user's choice, so it neither counts as
        // a claim nor survives colliding with one.
        hotkeyWasStored: typeof candidate.hotkey === "string",
      },
    ];
  });

  // Trimmed-exact comparison is deliberate and app-wide: the two consumers of
  // these strings — `registerCorrectionShortcut` in src/main/keybindings and the
  // pre-save `validateHotkeys` gate — match the same way, so case- or
  // alias-folding here alone would desynchronise the three. The capture UI only
  // ever emits canonical `Control+Shift+X`. Pinned by the "does NOT case-fold"
  // test in normalizeCorrectionSettings.test.ts.
  //
  // Claims come from STORED presets only, so this defends stored-vs-materialized
  // and nothing else. Two DEFAULTS sharing one accelerator is invisible here and
  // would just let the earlier one win in `registerCorrectionShortcut`: the
  // built-in default hotkeys must stay pairwise-unique, which is pinned by the
  // "hotkeys distinct from every other default" test, not by this function.
  const hotkeysClaimedByStoredPresets = new Set(
    normalizedEntries
      .filter((entry) => entry.hotkeyWasStored)
      .map((entry) => entry.preset.hotkey.trim())
      .filter((hotkey) => hotkey.length > 0),
  );

  // Built-in defaults are emitted ahead of custom presets, and
  // `registerCorrectionShortcut` registers in array order (first wins). So a
  // default hotkey materialized here — because the built-in was absent from the
  // stored config, or because its stored entry carried no `hotkey` field — would
  // silently outrank a stored preset already sitting on that accelerator. Give
  // up the default instead; a STORED hotkey is the user's explicit choice and is
  // never rewritten, not even when two stored presets collide with each other
  // (that stays the pre-save `validateHotkeys` gate's job).
  const withoutStolenHotkey = (preset: CorrectionPreset): CorrectionPreset =>
    hotkeysClaimedByStoredPresets.has(preset.hotkey.trim())
      ? { ...preset, hotkey: "" }
      : withoutReservedHotkey(preset);

  const normalizedPresets = normalizedEntries.map((entry) =>
    entry.hotkeyWasStored ? entry.preset : withoutStolenHotkey(entry.preset),
  );

  const presets = [
    ...defaults.presets.map(
      (defaultPreset) =>
        normalizedPresets.find((preset) => preset.id === defaultPreset.id) ||
        withoutStolenHotkey(defaultPreset),
    ),
    ...normalizedPresets.filter((preset) => !defaultById.has(preset.id)),
  ];

  const migratedPresets = applyLegacyTranslateMigration(
    presets,
    legacyTranslate,
    storedHadTranslatePreset,
  );

  const selectedPresetId =
    typeof raw.selectedPresetId === "string" &&
    migratedPresets.some((preset) => preset.id === raw.selectedPresetId)
      ? raw.selectedPresetId
      : migratedPresets[0]?.id || DEFAULT_CORRECTION_PRESET_ID;

  return {
    presets: migratedPresets,
    selectedPresetId,
    combos,
  };
};

/**
 * `Schema<T>` types only the TOP-LEVEL keys of `apiStoreSchema`; nested
 * `properties` blocks are unchecked, so a typo'd nested key (`enabledProvider`)
 * compiles clean while silently orphaning the field from ajv validation and
 * defaulting. `TypedSchemaFor` closes that gap. `Model[]` is carved out because
 * the `models` schema node mirrors a raw provider listing, not the persisted
 * `Model` shape. `ValueSchema` is derived structurally because
 * `json-schema-typed` is only a transitive dependency, never a direct one.
 */
type ValueSchema = Schema<{ value: unknown }>["value"];
type ValueSchemaObject = Extract<ValueSchema, object>;

type TypedSchemaFor<T> = T extends Model[]
  ? ValueSchema
  : T extends readonly (infer Item)[]
    ? Omit<ValueSchemaObject, "items" | "default"> & {
        items?: TypedSchemaFor<Item>;
        default?: T;
      }
    : T extends Record<string, unknown>
      ? Omit<ValueSchemaObject, "properties" | "required" | "default"> & {
          properties?: { [K in keyof T]?: TypedSchemaFor<T[K]> };
          required?: readonly (keyof T & string)[];
          default?: T;
        }
      : ValueSchema;

export const apiStoreSchema = {
  currentProfileId: { type: "string", default: "" },
  /** Migration marker only — bumped by `migrateStoredProfilesForModelRefs`, never read by feature code. */
  configVersion: { type: "number", default: 0 },
  profiles: {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        settings: {
          type: "object",
          properties: {
            // Never give this a valued default: ajv's useDefaults injects it into
            // every profile on read and it lands in plaintext config.json. Secrets
            // live in safeStorage via profileSecretStore. The "" is load bearing —
            // the type is a required string and withoutProfileSecrets deletes the
            // key, so without it a scrubbed profile reads back undefined.
            apiKey: {
              type: "string",
              default: "",
            },
            // "" means "inherit the global default" (resolved by getDefaultModelId);
            // anything else is a composite `<providerId>::<rawModelId>` ref.
            selectedModel: { type: "string", default: "" },
            /**
             * NEVER add an ajv `enum` here. `apiStore` is constructed with
             * `clearInvalidConfig: true`, so one value failing schema validation
             * wipes the ENTIRE config — every profile, preset, and key reference.
             * Validity is enforced in code by `sanitizeEnabledProviders`.
             */
            enabledProviders: { type: "array", items: { type: "string" }, default: [] },
            providerEndpoints: { type: "object", default: {} },
            openaiProjectId: { type: "string", default: "" },
            models: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  object: { type: "string" },
                  created: { type: "number" },
                  owned_by: { type: "string" },
                },
                required: ["id"],
              },
              default: [],
            },
            customSystemPrompt: { type: "string", default: "" },
            customUserPrompt: { type: "string", default: "" },
            tone: { type: "string", default: "" },
            settingsCorrect: {
              type: "object",
              properties: {
                selectedPresetId: {
                  type: "string",
                  default: DEFAULT_CORRECTION_PRESET_ID,
                },
                presets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      hotkey: { type: "string" },
                      systemPrompt: { type: "string" },
                      model: { type: "string" },
                      isBuiltIn: { type: "boolean" },
                      reasoning: { type: "string" },
                      requiresInput: { type: "boolean" },
                      /**
                       * NEVER an `enum`, for the reason spelled out on
                       * `enabledProviders` above: `clearInvalidConfig: true`
                       * means one stored value failing validation wipes every
                       * profile, preset and key reference. A legacy or hand-
                       * edited `outputMode` must degrade to the built-in
                       * default, which `sanitizePresetOutputMode` does in code.
                       */
                      outputMode: { type: "string" },
                      markdownOutput: { type: "boolean" },
                      /**
                       * Bare on purpose, and it must STAY bare: no `enum`, no
                       * `properties`, no `required` entry, no
                       * `additionalProperties`, no `default`. Which keys are
                       * legal and which values each one admits is registry
                       * DATA, and it changes every time a preset declares a
                       * new option — so a schema constraint here would be
                       * wrong for exactly the stored configs written by an
                       * older or newer build. With `clearInvalidConfig: true`
                       * that is not a rejected field, it is a wipe of every
                       * profile, preset and key reference. Validity is decided
                       * in code by `sanitizePresetOptions`, which drops the
                       * unrecognized key and keeps the rest.
                       */
                      extraOptions: { type: "object" },
                    },
                    required: ["id", "name", "hotkey", "systemPrompt", "model"],
                  },
                  default: makeDefaultCorrectionPresets(),
                },
                /**
                 * Deliberately carries NO `items` schema, unlike `presets`
                 * above, and no `default`. Combos are hand-edited config until
                 * the Settings editor lands, and `clearInvalidConfig: true`
                 * turns ONE mistyped field into a wipe of every profile, preset
                 * and key reference. Per-combo shape is enforced in code by
                 * `sanitizeCombos`, which drops just the malformed combo. Only
                 * "not an array at all" is worth a validation failure here, and
                 * that matches what `presets` already risks.
                 */
                combos: { type: "array" },
              },
              default: getDefaultCorrectionSettings(),
            },
            settingsSummarize: {
              type: "object",
              properties: {
                minLength: { type: "number", default: 0 },
                maxLength: { type: "number", default: 0 },
                model: { type: "string", default: "" },
                targetLanguage: { type: "string", default: DEFAULT_LANGUAGE },
              },
              default: {
                minLength: 0,
                maxLength: 0,
                model: "",
                targetLanguage: DEFAULT_LANGUAGE,
              },
            },
            settingsPromptGen: {
              type: "object",
              properties: {
                minLength: { type: "number", default: 50 },
                maxLength: { type: "number", default: 150 },
                batchCount: { type: "number", default: 5 },
                nsfw: { type: "boolean", default: true },
                context: { type: "string", default: "" },
                autoCopy: { type: "boolean", default: false },
                model: { type: "string", default: "" },
              },
              default: {
                minLength: 50,
                maxLength: 150,
                batchCount: 5,
                nsfw: true,
                context: "",
                autoCopy: false,
                model: "",
              },
            },
            settingsAutocomplete: {
              type: "object",
              properties: {
                // NEVER an ajv `enum` or `required` here — same reason spelled
                // out on `enabledProviders` and `outputMode`: this store runs
                // `clearInvalidConfig: true`, so ONE stored value failing
                // validation wipes every profile, preset and key reference.
                enabled: { type: "boolean", default: false },
                model: { type: "string", default: "" },
                // No `minimum`/`maximum` here either, for the same reason: a
                // stored value outside the range must be CLAMPED by
                // `normalizeDailyCostCapUsd`, not fail validation and wipe the
                // whole config.
                dailyCostCapUsd: { type: "number", default: DEFAULT_DAILY_COST_CAP_USD },
              },
              // Belt and braces for the whole-node-absent case only.
              // `useDefaults` injects an *object* default, so a stored object
              // missing just `enabled` never receives it — that case is carried
              // by `normalizeAutocompleteSettings`, which is the load-bearing one.
              default: {
                enabled: false,
                model: "",
                dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
              },
            },
          },
        },
      },
      required: ["id", "name", "createdAt", "settings"],
    },
    default: [],
  },
} satisfies Schema<{
  profiles: Profile[];
  currentProfileId: string;
  configVersion: number;
}> & {
  profiles: TypedSchemaFor<Profile[]>;
};

export const apiStore = new Store<{ profiles: Profile[] }>({
  schema: apiStoreSchema,
  encryptionKey: "fixlang-secure-encryption-key",
  clearInvalidConfig: true,
  watch: true,
});

/**
 * A type-only re-view of `apiStore` — no new instance, no schema change.
 * `conf`'s `.get`/`.set` carry a catch-all `string` overload, so a typo'd key
 * (`"configVresion"`) type-checks even if `configVersion` is added to the store
 * generic. This narrower view has no such fallback, so tsc rejects the typo.
 */
type ConfigVersionShape = { configVersion: number };
type ConfigVersionStore = {
  get(key: keyof ConfigVersionShape, defaultValue: number): number;
  set(key: keyof ConfigVersionShape, value: number): void;
};
const configVersionStore = apiStore as unknown as ConfigVersionStore;

export const getOpenAIKey = () => {
  const apiKey = apiStore.get("apiKey");
  if (!apiKey) {
    throw new Error("OpenAI API Key not set in settings.");
  }
  return apiKey;
};

/**
 * Resolves the effective global default model ref — the single source of truth
 * that presets with an empty model inherit.
 */
export const getDefaultReasoningEffort = (): ReasoningEffort =>
  sanitizeReasoningEffort(getProfileSetting("defaultReasoningEffort")) ??
  DEFAULT_REASONING_EFFORT;

export const getDefaultModelId = (): string => {
  const settings = getCurrentProfileSettings();
  if (settings.selectedModel) {
    return settings.selectedModel;
  }
  const resolved = resolveDefaultModel(settings.models ?? []);
  return resolved ? modelRefForModel(resolved) : "";
};

/** Which model refs a disconnect reset to the inherit sentinel, for the UI's warning. */
export type ClearedModelRefs = {
  selectedModel: boolean;
  presetIds: string[];
  features: ("promptGen" | "summarize" | "autocomplete")[];
};

const NO_CLEARED_REFS: ClearedModelRefs = {
  selectedModel: false,
  presetIds: [],
  features: [],
};

// Builds a NEW profiles array: the one `getProfiles()` returns is the store's own
// value, so an in-place write would mutate state a caller may still be holding.
const commitProfileAt = (
  profiles: Profile[],
  index: number,
  settings: SettingsStore,
): Profile => {
  const updated = {
    ...profiles[index],
    updatedAt: new Date().toISOString(),
    settings,
  } satisfies Profile;
  apiStore.set(
    "profiles",
    profiles.map((profile, i) => (i === index ? updated : profile)),
  );
  return updated;
};

/**
 * Connect a provider to `profileId`: mark it enabled and replace its model slice.
 * Must NOT touch `selectedModel` or any preset/feature model — a composite ref
 * names its own provider, so connecting one provider never invalidates another's.
 */
export const connectProviderToProfile = (
  profileId: string,
  provider: ProviderId,
  providerModels: Model[],
  options?: { endpoint?: ProviderEndpoint; openaiProjectId?: string },
): Profile | null => {
  const profiles = getProfiles();
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index === -1) return null;

  const settings = profiles[index].settings;
  const previousModels = settings.models || [];
  // `isModelForProvider`, not `model.provider === provider`: an untagged legacy
  // cache entry would otherwise survive as a duplicate of a model just refetched.
  const retainedModels = previousModels.filter(
    (model) => !isModelForProvider(model, provider),
  );

  const providerEndpoints =
    options?.endpoint && (provider === "lmstudio" || provider === "ollama" || provider === "bedrock")
      ? {
          ...sanitizeProviderEndpoints(settings.providerEndpoints),
          [provider]: options.endpoint,
        }
      : sanitizeProviderEndpoints(settings.providerEndpoints);

  return commitProfileAt(profiles, index, {
    ...settings,
    enabledProviders: sanitizeEnabledProviders([
      ...(settings.enabledProviders ?? []),
      provider,
    ]),
    models: [
      ...retainedModels,
      ...providerModels.map((model) => ({
        ...model,
        provider: model.provider ?? provider,
      })),
    ],
    providerEndpoints,
    // Absent means "leave what is stored"; `""` is a deliberate clear, so the
    // key must only be written when the caller actually supplied a value.
    ...(options?.openaiProjectId !== undefined
      ? { openaiProjectId: sanitizeOpenAIProjectId(options.openaiProjectId) ?? "" }
      : {}),
  });
};

export const connectProviderToActiveProfile = (
  provider: ProviderId,
  providerModels: Model[],
): Profile | null =>
  connectProviderToProfile(getCurrentProfileId(), provider, providerModels);

/** True when `ref` explicitly names `provider`. A bare ref never matches. */
const refBelongsToProvider = (ref: string, provider: ProviderId): boolean =>
  parseModelRef(ref).provider === provider;

/**
 * Disconnect a provider from `profileId`: drop it from `enabledProviders`, drop
 * its model slice, and reset every ref that named it to the inherit sentinel.
 * Bare (provider-less) refs are deliberately left alone — clearing them would mean
 * guessing ownership from the id shape, which composite refs exist to prevent.
 * Disconnecting an unconnected provider writes nothing.
 */
export const disconnectProviderFromProfile = (
  profileId: string,
  provider: ProviderId,
): { profile: Profile; cleared: ClearedModelRefs } | null => {
  const profiles = getProfiles();
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index === -1) return null;

  const settings = profiles[index].settings;
  const enabledProviders = sanitizeEnabledProviders(settings.enabledProviders);
  if (!enabledProviders.includes(provider)) {
    return { profile: profiles[index], cleared: NO_CLEARED_REFS };
  }

  // Deliberately NOT `normalizeCorrectionSettings` — it materializes missing
  // built-in presets, so a disconnect would add presets the user never had.
  const correct = settings.settingsCorrect;
  const clearedPresetIds: string[] = [];
  const presets = (correct?.presets ?? []).map((preset) => {
    if (!refBelongsToProvider(preset.model, provider)) return preset;
    clearedPresetIds.push(preset.id);
    return { ...preset, model: INHERIT_GLOBAL_MODEL };
  });

  const clearedFeatures: ("promptGen" | "summarize" | "autocomplete")[] = [];
  const promptGenModel = settings.settingsPromptGen?.model ?? "";
  const summarizeModel = settings.settingsSummarize?.model ?? "";
  const autocompleteModel = settings.settingsAutocomplete?.model ?? "";
  if (refBelongsToProvider(promptGenModel, provider)) clearedFeatures.push("promptGen");
  if (refBelongsToProvider(summarizeModel, provider)) clearedFeatures.push("summarize");
  // Without this the feature keeps firing at a provider whose key is gone —
  // one failed request per keystroke rather than a single visible error.
  if (refBelongsToProvider(autocompleteModel, provider)) clearedFeatures.push("autocomplete");

  const clearedSelectedModel = refBelongsToProvider(
    settings.selectedModel ?? "",
    provider,
  );

  const profile = commitProfileAt(profiles, index, {
    ...settings,
    enabledProviders: enabledProviders.filter((entry) => entry !== provider),
    models: (settings.models || []).filter(
      (model) => !isModelForProvider(model, provider),
    ),
    selectedModel: clearedSelectedModel
      ? INHERIT_GLOBAL_MODEL
      : (settings.selectedModel ?? ""),
    // The project belongs to the organization the admin key names, so it does not
    // survive the connection. Reconnecting with a key for a DIFFERENT org would
    // otherwise keep attributing spend to a project that org has never heard of.
    ...(provider === "openai" ? { openaiProjectId: "" } : {}),
    settingsCorrect: { ...correct, presets },
    settingsPromptGen: {
      ...settings.settingsPromptGen,
      model: clearedFeatures.includes("promptGen")
        ? INHERIT_GLOBAL_MODEL
        : promptGenModel,
    },
    settingsSummarize: {
      ...settings.settingsSummarize,
      model: clearedFeatures.includes("summarize")
        ? INHERIT_GLOBAL_MODEL
        : summarizeModel,
    },
    settingsAutocomplete: {
      ...normalizeAutocompleteSettings(settings.settingsAutocomplete),
      model: clearedFeatures.includes("autocomplete")
        ? AUTOCOMPLETE_INHERIT_ASK_MODEL
        : autocompleteModel,
    },
  });

  return {
    profile,
    cleared: {
      selectedModel: clearedSelectedModel,
      presetIds: clearedPresetIds,
      features: clearedFeatures,
    },
  };
};

export const disconnectProviderFromActiveProfile = (
  provider: ProviderId,
): { profile: Profile; cleared: ClearedModelRefs } | null =>
  disconnectProviderFromProfile(getCurrentProfileId(), provider);

/**
 * One-shot driver for `migrateProfileForModelRefs`, gated by `configVersion`.
 * Reads the RAW stored `profiles`, never `getProfiles()` — a migration must see
 * exactly what is on disk, not whatever shape a later helper layers on top.
 * Idempotence rests on two independent guards: this gate, and
 * `migrateProfileForModelRefs` being a fixed point on an already-migrated profile.
 */
export const migrateStoredProfilesForModelRefs = (): void => {
  if (configVersionStore.get("configVersion", 0) >= 1) {
    return;
  }
  const raw = apiStore.get("profiles", []) as unknown[];
  const next = raw.map(migrateProfileForModelRefs);
  apiStore.set("profiles", next);
  configVersionStore.set("configVersion", 1);
};

/**
 * Creates a profile from current settings
 * @param name Profile name
 * @param description Optional profile description
 * @returns The created profile
 */
export const createProfile = (
  name = "Default Profile",
  description = "",
): Profile => {
  const now = new Date().toISOString();

  const profile = {
    id: `profile_${Date.now()}`,
    name,
    description,
    createdAt: now,
    updatedAt: now,
    // New profiles never inherit another profile's selected model, cached
    // models, or legacy plaintext key. Provider setup is intentionally staged
    // by the Settings flow that follows this state change.
    settings: buildDefaultProfileSettings(),
  } satisfies Profile;

  // Add to profiles array
  const profiles = apiStore.get("profiles", []) as Profile[];
  profiles.push(profile);
  apiStore.set("profiles", profiles);

  // Set as current profile
  apiStore.set("currentProfileId", profile.id);

  return profile;
};

/**
 * Gets all saved profiles
 * @returns Array of saved profiles
 */
export const getProfiles = (): Profile[] => {
  return apiStore.get("profiles", []) as Profile[];
};

/**
 * Gets current profile ID
 * @returns Current profile ID or empty string if none
 */
export const getCurrentProfileId = (): string => {
  return apiStore.get("currentProfileId", "") as string;
};

/**
 * Gets a profile by ID
 * @param profileId Profile ID to get
 * @returns Profile or null if not found
 */
export const getProfileById = (profileId: string): Profile | null => {
  const profiles = getProfiles();
  return profiles.find((profile) => profile.id === profileId) || null;
};

/**
 * Gets all settings from the current profile
 * @returns All settings from the current profile (or creates a default profile if none active)
 */
export const getCurrentProfileSettings = (): SettingsStore => {
  const currentProfileId = apiStore.get("currentProfileId", "");

  // If no current profile, return the default settings object
  if (!currentProfileId) {
    const defaultSettings =
      (apiStore.get("settings") as SettingsStore) || ({} as SettingsStore);
    return defaultSettings;
  }

  const profiles = getProfiles();
  const currentProfile = profiles.find((p) => p.id === currentProfileId);

  // If profile not found, return default settings
  if (!currentProfile) {
    return (apiStore.get("settings") as SettingsStore) || ({} as SettingsStore);
  }

  return currentProfile.settings;
};

/**
 * Pull the retired standalone-Translate settings out of a raw profile settings
 * object. The field was removed from SettingsStore, so it is read defensively
 * via an unknown cast — upgrading users still have it in the persisted JSON.
 */
const extractLegacyTranslateSettings = (
  settings: SettingsStore,
): LegacyTranslateSettings | undefined => {
  const legacy = (settings as { settingsTranslate?: unknown }).settingsTranslate;
  if (!legacy || typeof legacy !== "object") {
    return undefined;
  }
  const t = legacy as Record<string, unknown>;
  return {
    destinationLang:
      typeof t.destinationLang === "string" ? t.destinationLang : undefined,
    includeExplanation:
      typeof t.includeExplanation === "boolean"
        ? t.includeExplanation
        : undefined,
    model: typeof t.model === "string" ? t.model : undefined,
  };
};

/**
 * Gets a specific setting from the current profile
 * @param settingType The type of setting to retrieve
 * @returns The requested setting from the current profile
 */
export const getProfileSetting = <K extends keyof SettingsStore>(
  settingType: K,
): SettingsStore[K] => {
  const settings = getCurrentProfileSettings();

  if (settingType === "settingsCorrect") {
    return normalizeCorrectionSettings(
      settings[settingType],
      // Carry over the retired standalone-Translate settings (still present in
      // the raw store for upgrading users; no longer on the SettingsStore type).
      extractLegacyTranslateSettings(settings),
    ) as SettingsStore[K];
  }

  if (settingType === "providerEndpoints") {
    return sanitizeProviderEndpoints(settings.providerEndpoints) as SettingsStore[K];
  }

  if (settingType === "openaiProjectId") {
    return sanitizeOpenAIProjectId(settings.openaiProjectId) as SettingsStore[K];
  }

  // Reading through the normalizer is what keeps the feature off for a profile
  // that predates it: the stored node is absent, and absent reads as disabled.
  if (settingType === "settingsAutocomplete") {
    return normalizeAutocompleteSettings(settings.settingsAutocomplete) as SettingsStore[K];
  }

  return settings[settingType];
};

/**
 * Applies settings from a profile
 * @param profileId Profile ID to apply
 * @returns Success status and error message if applicable
 */
export const applyProfile = (
  profileId: string,
): { success: boolean; error?: string } => {
  try {
    const profile = getProfileById(profileId);
    if (!profile) {
      return { success: false, error: "Profile not found" };
    }

    // Set as current profile - we no longer copy settings to the global level
    apiStore.set("currentProfileId", profileId);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error applying profile",
    };
  }
};

/**
 * Updates a specific setting in the current profile
 * @param settingType The type of setting to update
 * @param value The new value for the setting
 * @returns Success status and error message if applicable
 */
export const updateProfileSetting = <K extends keyof SettingsStore>(
  settingType: K,
  value: SettingsStore[K],
): { success: boolean; error?: string } => {
  try {
    const normalizedValue =
      settingType === "settingsCorrect"
        ? (normalizeCorrectionSettings(value) as SettingsStore[K])
        : settingType === "providerEndpoints"
          ? (sanitizeProviderEndpoints(value) as SettingsStore[K])
          : settingType === "openaiProjectId"
            ? // "" rather than undefined: the schema types this as a string, and a
              // deleted key would read back as the ajv default anyway.
              ((sanitizeOpenAIProjectId(value) ?? "") as SettingsStore[K])
            : settingType === "settingsAutocomplete"
              ? (normalizeAutocompleteSettings(value) as SettingsStore[K])
              : value;

    const currentProfileId = apiStore.get("currentProfileId", "");

    // If no active profile, create a new default profile
    if (!currentProfileId) {
      const newProfile = createProfile();
      apiStore.set("currentProfileId", newProfile.id);

      // Update the newly created profile
      return updateProfileSetting(settingType, normalizedValue);
    }

    const profiles = getProfiles();
    const profileIndex = profiles.findIndex((p) => p.id === currentProfileId);

    // If profile not found, create a new one
    if (profileIndex === -1) {
      const newProfile = createProfile();
      apiStore.set("currentProfileId", newProfile.id);

      // Update the newly created profile
      return updateProfileSetting(settingType, normalizedValue);
    }

    // Create updated profile with the new setting
    const updatedProfile = {
      ...profiles[profileIndex],
      updatedAt: new Date().toISOString(),
      settings: {
        ...profiles[profileIndex].settings,
        [settingType]: normalizedValue,
      },
    };

    // Update the profile in the profiles array
    profiles[profileIndex] = updatedProfile;
    apiStore.set("profiles", profiles);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error updating profile setting",
    };
  }
};

/**
 * Builds a fresh SettingsStore with all user-tunable settings at their
 * defaults. apiKey / models are intentionally empty here — callers that
 * preserve them (e.g. profile reset) overwrite those fields afterwards.
 */
const buildDefaultProfileSettings = (): SettingsStore =>
  ({
    apiKey: "",
    models: [],
    selectedModel: "",
    enabledProviders: [],
    providerEndpoints: {},
    openaiProjectId: "",
    customSystemPrompt: "",
    customUserPrompt: "",
    tone: "",
    settingsCorrect: getDefaultCorrectionSettings(),
    settingsSummarize: {
      minLength: 0,
      maxLength: 0,
      model: "",
      targetLanguage: DEFAULT_LANGUAGE,
    },
    settingsPromptGen: {
      minLength: 50,
      maxLength: 150,
      batchCount: 5,
      nsfw: true,
      context: "",
      autoCopy: false,
      model: "",
    },
    settingsAutocomplete: {
      enabled: false,
      model: AUTOCOMPLETE_INHERIT_ASK_MODEL,
      dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
    },
  }) as SettingsStore;

/**
 * Resets the active profile's settings to defaults. Must preserve `apiKey`,
 * `models` and `enabledProviders` — dropping `enabledProviders` leaves the
 * Settings page showing Connected provider cards with zero models.
 */
export const resetCurrentProfileSettings = (): {
  success: boolean;
  error?: string;
} => {
  try {
    const currentProfileId = getCurrentProfileId();
    if (!currentProfileId) {
      return { success: false, error: "No active profile to reset" };
    }

    const profiles = getProfiles();
    const index = profiles.findIndex((p) => p.id === currentProfileId);
    if (index === -1) {
      return { success: false, error: "Active profile not found" };
    }

    const existing = profiles[index].settings;
    const defaults = buildDefaultProfileSettings();

    profiles[index] = {
      ...profiles[index],
      updatedAt: new Date().toISOString(),
      settings: {
        ...defaults,
        apiKey: existing.apiKey ?? "",
        models: existing.models ?? [],
        enabledProviders: existing.enabledProviders ?? [],
        providerEndpoints: sanitizeProviderEndpoints(existing.providerEndpoints),
      },
    };
    apiStore.set("profiles", profiles);

    // Clear the legacy top-level selected model (not part of the typed schema)
    // so get-selected-model falls back to the dynamic default after reset.
    (apiStore as unknown as { delete: (key: string) => void }).delete(
      "selectedModel",
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error resetting profile settings",
    };
  }
};

/**
 * Remove legacy plaintext secrets before a profile crosses a process/device boundary.
 *
 * **Must stay secrets-only — do NOT widen it to strip model state.** The
 * legacy-secret migration in `src/features/profiles/main/profiles.ts` writes this
 * result straight back to disk, so anything stripped here is permanently deleted
 * from every upgrading user's config. Wider stripping belongs in
 * {@link toExportableProfile}.
 */
export const withoutProfileSecrets = (profile: Profile): Profile => {
  const settings = { ...profile.settings } as SettingsStore;
  delete (settings as Partial<SettingsStore>).apiKey;
  return {
    ...profile,
    settings,
  } as Profile;
};

/**
 * The shape a profile takes when it leaves this machine: secrets plus all
 * per-machine model state removed. Cleared to empty values rather than deleted so
 * the result still validates against `apiStoreSchema`. Never call this where
 * {@link withoutProfileSecrets} is expected — that one is written back to disk.
 */
export const toExportableProfile = (profile: Profile): Profile => {
  const base = withoutProfileSecrets(profile);
  const settings = base.settings;
  return {
    ...base,
    settings: {
      ...settings,
      models: [],
      selectedModel: INHERIT_GLOBAL_MODEL,
      enabledProviders: [],
      providerEndpoints: {},
      // Names a project inside the exporter's own OpenAI organization — account
      // detail, not a portable setting, so it leaves with the connections.
      openaiProjectId: "",
      // Not normalized: an export must not invent presets the user never had.
      settingsCorrect: {
        ...settings.settingsCorrect,
        presets: (settings.settingsCorrect?.presets ?? []).map((preset) => ({
          ...preset,
          model: INHERIT_GLOBAL_MODEL,
        })),
      },
      settingsPromptGen: {
        ...settings.settingsPromptGen,
        model: INHERIT_GLOBAL_MODEL,
      },
      settingsSummarize: {
        ...settings.settingsSummarize,
        model: INHERIT_GLOBAL_MODEL,
      },
      // The ref is per-machine model state; `enabled` is a genuine preference
      // and travels with the profile.
      settingsAutocomplete: {
        ...normalizeAutocompleteSettings(settings.settingsAutocomplete),
        model: AUTOCOMPLETE_INHERIT_ASK_MODEL,
      },
    },
  } as Profile;
};

/** An imported profile is untrusted: its plaintext key and model state both go. */
export const sanitizeImportedProfile = toExportableProfile;

/**
 * Updates a profile with current settings
 * @param profileId Profile ID to update
 * @param name Optional new name
 * @param description Optional new description
 * @returns Updated profile or null if not found
 */
export const updateProfile = (
  profileId: string,
  name?: string,
  description?: string,
): Profile | null => {
  const profiles = getProfiles();
  const profileIndex = profiles.findIndex((p) => p.id === profileId);

  if (profileIndex === -1) {
    return null;
  }

  const updatedProfile = {
    ...profiles[profileIndex],
    name: name || profiles[profileIndex].name,
    description:
      description !== undefined
        ? description
        : profiles[profileIndex].description,
    updatedAt: new Date().toISOString(),
  } satisfies Profile;

  profiles[profileIndex] = updatedProfile;
  apiStore.set("profiles", profiles);

  return updatedProfile;
};

/**
 * Deletes a profile
 * @param profileId Profile ID to delete
 * @returns Success status
 */
export const deleteProfile = (profileId: string): boolean => {
  const profiles = getProfiles();
  const filteredProfiles = profiles.filter((p) => p.id !== profileId);

  if (filteredProfiles.length === profiles.length) {
    return false; // No profile found to delete
  }

  apiStore.set("profiles", filteredProfiles);

  // If deleted the current profile, reset current profile ID
  if (getCurrentProfileId() === profileId) {
    apiStore.set(
      "currentProfileId",
      filteredProfiles.length > 0 ? filteredProfiles[0].id : "",
    );
  }

  return true;
};

/**
 * Switch to the next profile in the list (for Ctrl+Shift+P shortcut)
 * @returns The newly selected profile or null if no profiles
 */
export const switchToNextProfile = (): Profile | null => {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    return null;
  }

  const currentProfileId = getCurrentProfileId();
  const currentIndex = profiles.findIndex((p) => p.id === currentProfileId);

  // Get next profile index (loop back to 0 if at end)
  const nextIndex =
    currentIndex === -1 || currentIndex === profiles.length - 1
      ? 0
      : currentIndex + 1;

  const nextProfile = profiles[nextIndex];
  applyProfile(nextProfile.id);

  return nextProfile;
};

/**
 * Initializes a default profile if none exists
 * This should be called when the application starts
 */
export const initializeDefaultProfile = (): void => {
  migrateStoredProfilesForModelRefs();
  const profiles = getProfiles();
  if (profiles.length === 0) {
    console.log("Creating default profile");
    createProfile("Default Profile", "Default application settings");
  } else if (!getCurrentProfileId()) {
    // If we have profiles but no current selected, select the first one
    apiStore.set("currentProfileId", profiles[0].id);
  }
};
