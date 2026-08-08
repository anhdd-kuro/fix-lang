import React, { useEffect, useMemo, useState } from "react";
import {
  COMBO_MAX_STEPS,
  COMBO_MIN_STEPS,
} from "~/features/correction/shared/comboValidation";
import { msg, messageLabel, type Message } from "~/features/i18n/shared/message";
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_ASK_PRESET_PROMPT,
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_CUSTOM_PROMPT,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
  DEFAULT_SUMMARIZE_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_PROMPT,
  DEFAULT_TRANSLATE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_PROMPT,
} from "~/prompts/correction";
import { useI18n } from "../i18n/useI18n";
import { splitHotkey } from "./about/userGuideView";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import {
  addComboStep,
  buildComboStepPresetLookup,
  canAddComboStep,
  canMoveComboStep,
  collectComboErrors,
  comboStepNeedsInlineInput,
  createComboDraft,
  createComboStep,
  createInitialComboSteps,
  hasBlockingComboErrors,
  mapComboErrorsToFieldMessages,
  moveComboStep,
  nextComboDraftName,
  removeComboStep,
  setComboStepInlineInput,
  setComboStepPreset,
  type ComboStepDirection,
} from "./comboEditorView";
import {
  buildComboEstimatePresetLookup,
  buildPriceMap,
  COMBO_ESTIMATE_BASELINE_CHARS,
  estimateCombo,
  resolveComboCostDisplay,
} from "./comboEstimate";
import { ModelSelect } from "./ModelSelect";
import { PROVIDER_LABEL_KEYS } from "./modelSelectOptions";
import { ReasoningEffortSlider } from "./ReasoningEffortSlider";
import { Select } from "./Select/Select";
import {
  plainStatus,
  wrappedError,
  resolveStatus,
  type StatusDescriptor,
} from "./statusDescriptor";
import { validateHotkeys } from "./validateHotkeys";
import type { ReasoningEffort } from "~/features/correction/shared/reasoningEffort";
import type {
  ComboPreset,
  ComboStep,
  CorrectionPreset,
  CorrectionSettings,
  Model,
} from "~/features/providers/store/apiStore";

/**
 * Read-only hotkey chips for the preset list. Matches `HotkeyChips` in
 * `UserGuidePanel` / `KeyBinding` so Settings and the guide share one look.
 * On a selected (primary) card, chips inherit the button foreground so they
 * stay readable and do not fight the primary text color.
 */
const PresetHotkeyChips = ({
  hotkey,
  emptyLabel,
  selected,
}: {
  hotkey: string;
  emptyLabel: string;
  selected: boolean;
}) => {
  const keys = splitHotkey(hotkey);
  if (keys.length === 0) {
    return (
      <span
        className={`mt-1 block truncate text-xs ${
          selected ? "text-inherit opacity-80" : "text-muted-foreground"
        }`}
      >
        {emptyLabel}
      </span>
    );
  }
  return (
    <ul className="mt-1 inline-flex flex-wrap items-center gap-1">
      {/* Index-keyed: a combo can repeat a token; a duplicate React key would drop a chip. */}
      {keys.map((key, index) => (
        <li
          key={`${String(index)}-${key}`}
          className={`inline-block rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold ${
            selected
              ? "border-primary-foreground/35 bg-primary-foreground/15 text-inherit"
              : "border-control-border bg-muted text-foreground"
          }`}
        >
          {key}
        </li>
      ))}
    </ul>
  );
};

// why: preset display names ("Correction", "Summarize", …) are user-editable
// data (renamed freely in the UI, just like a custom preset's name), not UI
// chrome — per the i18n plan, user-authored/user-owned data is interpolated,
// never translated. Only the surrounding labels/buttons/messages below go
// through `t()`.

export const makeBuiltInPresetDefaults = (): Record<
  string,
  CorrectionPreset
> => ({
  [DEFAULT_CORRECTION_PRESET_ID]: {
    id: DEFAULT_CORRECTION_PRESET_ID,
    name: "Correction",
    hotkey: "Control+Shift+F",
    systemPrompt: DEFAULT_CUSTOM_PROMPT.trim(),
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
  [DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID]: {
    id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
    name: "Prompt optimization",
    hotkey: "Control+Shift+D",
    systemPrompt: DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
    reasoning: "low",
  },
  [DEFAULT_SUMMARIZE_PRESET_ID]: {
    id: DEFAULT_SUMMARIZE_PRESET_ID,
    name: "Summarize",
    hotkey: "Control+Shift+S",
    systemPrompt: DEFAULT_SUMMARIZE_PRESET_PROMPT,
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
  [DEFAULT_TRANSLATE_PRESET_ID]: {
    id: DEFAULT_TRANSLATE_PRESET_ID,
    name: "Translate",
    hotkey: "Control+Shift+T",
    systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT.trim(),
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
  [DEFAULT_BUSINESS_WRITING_PRESET_ID]: {
    id: DEFAULT_BUSINESS_WRITING_PRESET_ID,
    name: "Business Writing",
    hotkey: "Control+Shift+B",
    systemPrompt: DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
    reasoning: "low",
  },
  [DEFAULT_STRUCTURED_TEXT_PRESET_ID]: {
    id: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    name: "Context-Aware Structured Text",
    hotkey: "Control+Shift+R",
    systemPrompt: DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
  [DEFAULT_ASK_PRESET_ID]: {
    id: DEFAULT_ASK_PRESET_ID,
    name: "Ask AI",
    hotkey: "Control+Shift+A",
    systemPrompt: DEFAULT_ASK_PRESET_PROMPT,
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
    // Kept in field-for-field parity with `makeDefaultCorrectionPresets()`;
    // `minimal` was retired upstream and is no longer a `ReasoningEffort`.
    reasoning: "low",
    requiresInput: true,
    outputMode: "popup",
    markdownOutput: true,
  },
});

const buildDefaultSettings = (): CorrectionSettings => ({
  presets: Object.values(makeBuiltInPresetDefaults()),
  selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
});

const makeCustomPreset = (count: number): CorrectionPreset => ({
  id: `custom-${Date.now()}`,
  name: `Custom preset ${count}`,
  hotkey: "",
  systemPrompt: DEFAULT_CUSTOM_PROMPT.trim(),
  model: "", // empty = inherit the global default model
  isBuiltIn: false,
});

const captureHotkey = (
  event: React.KeyboardEvent<HTMLInputElement>,
): string => {
  event.preventDefault();

  const parts: string[] = [];

  if (event.ctrlKey) parts.push("Control");
  if (event.metaKey) parts.push("Command");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;

  if (!["Control", "Command", "Alt", "Shift"].includes(key)) {
    parts.push(key);
  }

  return parts.join("+");
};

/**
 * Validates form fields (name + systemPrompt) on each preset.
 * Returns the first violation as a locale-free `Message` descriptor (never
 * prose — see the fixlang-i18n skill's "aggregations return descriptors"
 * note), or null if all fields are valid. Hotkey conflict validation is
 * handled separately by validateHotkeys().
 */
const validateFormFields = (settings: CorrectionSettings): Message | null => {
  for (const preset of settings.presets) {
    if (!preset.name.trim()) {
      return msg("settings.correction.error.nameRequired");
    }

    if (!preset.systemPrompt.trim()) {
      return msg("settings.correction.error.promptRequired", {
        name: preset.name,
      });
    }
  }

  return null;
};

export const SettingCorrection: React.FC = () => {
  const { t, tm, tl, formatNumber } = useI18n();
  const [correctionSettings, setCorrectionSettings] =
    useState<CorrectionSettings>(buildDefaultSettings);
  // Locale-free descriptor — was `useState("")` filled by `t()` at action
  // time, which froze the message into whatever locale was active when the
  // action ran and never re-translated after a later locale switch.
  const [status, setStatus] = useState<StatusDescriptor | null>(null);
  // Separate from `status` so the styling never depends on matching an
  // English "Error" prefix.
  const [statusIsError, setStatusIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [globalReasoningEffort, setGlobalReasoningEffort] =
    useState<ReasoningEffort>("none");
  // Feed the combo cost/provider estimate (risk 5 + 6) — cached models and
  // the global default model ref, the same two things `ModelSelect` already
  // fetches. Loaded alongside settings rather than duplicating a live fetch
  // per combo row.
  const [comboEstimateModels, setComboEstimateModels] = useState<Model[]>([]);
  const [comboGlobalDefaultModelRef, setComboGlobalDefaultModelRef] =
    useState<string>("");

  const builtInDefaults = useMemo(() => makeBuiltInPresetDefaults(), []);

  const activePreset =
    correctionSettings.presets.find(
      (preset) => preset.id === correctionSettings.selectedPresetId,
    ) || correctionSettings.presets[0];

  // Absent reads as `[]` — the whole migration (see `CorrectionSettings.combos`).
  // Memoized so a bare `?? []` fallback does not mint a new array reference
  // every render and defeat `comboErrorsById`'s memoization below.
  const combos = useMemo(
    () => correctionSettings.combos ?? [],
    [correctionSettings.combos],
  );

  const comboStepPresets = useMemo(
    () => buildComboStepPresetLookup(correctionSettings.presets),
    [correctionSettings.presets],
  );

  // Runs `validateCombo` for EVERY combo, not just the one being edited, so
  // Save stays blocked as long as any combo is invalid and every error for
  // every invalid combo is on screen at once.
  const comboErrorsById = useMemo(
    () => collectComboErrors(combos, correctionSettings.presets),
    [combos, correctionSettings.presets],
  );

  // Cost/provider transparency inputs (risk 5 + 6) — a preset-model lookup
  // and a price map, both derived once per settings/model change rather than
  // rebuilt per combo row.
  const comboEstimatePresetsById = useMemo(
    () => buildComboEstimatePresetLookup(correctionSettings.presets),
    [correctionSettings.presets],
  );
  const comboEstimatePriceMap = useMemo(
    () => buildPriceMap(comboEstimateModels),
    [comboEstimateModels],
  );

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const [settings, globalReasoning, modelsResult, defaultModelRef] =
        await Promise.all([
          window.electronAPI.getCorrectSettings(),
          window.electronAPI.getDefaultReasoningEffort?.() ??
            Promise.resolve(undefined),
          // Cached-only (no refetch): the combo estimate only needs whatever
          // `ModelSelect` has already fetched for pricing, not a fresh
          // network round-trip on every Settings load.
          window.electronAPI.fetchAIModels?.(false) ??
            Promise.resolve(undefined),
          window.electronAPI.getSelectedModel?.() ?? Promise.resolve(""),
        ]);
      if (globalReasoning) setGlobalReasoningEffort(globalReasoning);
      setCorrectionSettings(settings);
      if (modelsResult?.success && modelsResult.models) {
        setComboEstimateModels(modelsResult.models);
      }
      setComboGlobalDefaultModelRef(defaultModelRef ?? "");
    } catch (error) {
      console.error("Failed to load correction presets:", error);
      setCorrectionSettings(buildDefaultSettings());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, []);

  useEffect(() => {
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      loadSettings();
    });

    return () => off?.();
  }, []);

  const updatePreset = (
    presetId: string,
    updates: Partial<CorrectionPreset>,
  ) => {
    setCorrectionSettings((current) => ({
      ...current,
      presets: current.presets.map((preset) =>
        preset.id === presetId ? { ...preset, ...updates } : preset,
      ),
    }));
  };

  const handleAddPreset = () => {
    const nextPreset = makeCustomPreset(correctionSettings.presets.length + 1);

    setCorrectionSettings((current) => ({
      ...current,
      presets: [...current.presets, nextPreset],
      selectedPresetId: nextPreset.id,
    }));
    setStatus(null);
    setStatusIsError(false);
  };

  const handleDuplicatePreset = () => {
    if (!activePreset) {
      return;
    }

    const duplicatedPreset: CorrectionPreset = {
      ...activePreset,
      id: `custom-${Date.now()}`,
      name: `${activePreset.name} Copy`,
      hotkey: "",
      isBuiltIn: false,
    };

    setCorrectionSettings((current) => ({
      ...current,
      presets: [...current.presets, duplicatedPreset],
      selectedPresetId: duplicatedPreset.id,
    }));
    setStatus(null);
    setStatusIsError(false);
  };

  const handleDeletePreset = () => {
    if (!activePreset || activePreset.isBuiltIn) {
      return;
    }

    setCorrectionSettings((current) => {
      const presets = current.presets.filter(
        (preset) => preset.id !== activePreset.id,
      );
      const fallbackPreset =
        presets.find((preset) => preset.id === DEFAULT_CORRECTION_PRESET_ID) ||
        presets[0];

      return {
        ...current,
        presets,
        selectedPresetId: fallbackPreset?.id || DEFAULT_CORRECTION_PRESET_ID,
      };
    });
    setStatus(null);
    setStatusIsError(false);
  };

  const handleResetBuiltIn = () => {
    if (!activePreset?.isBuiltIn) {
      return;
    }

    const defaultPreset = builtInDefaults[activePreset.id];
    if (!defaultPreset) {
      return;
    }

    // Explicitly include these so Reset restores the built-in value even when
    // the current preset carries an override — a spread alone only overwrites
    // keys `defaultPreset` actually has, so an override sitting on a key the
    // built-in default omits (undefined) would otherwise survive the reset.
    updatePreset(activePreset.id, {
      ...defaultPreset,
      reasoning: defaultPreset.reasoning,
      requiresInput: defaultPreset.requiresInput,
      outputMode: defaultPreset.outputMode,
      markdownOutput: defaultPreset.markdownOutput,
    });
    setStatus(null);
    setStatusIsError(false);
  };

  const updateCombos = (
    updater: (combos: ComboPreset[]) => ComboPreset[],
  ): void => {
    setCorrectionSettings((current) => ({
      ...current,
      combos: updater(current.combos ?? []),
    }));
  };

  const updateCombo = (comboId: string, updates: Partial<ComboPreset>): void => {
    updateCombos((currentCombos) =>
      currentCombos.map((combo) =>
        combo.id === comboId ? { ...combo, ...updates } : combo,
      ),
    );
  };

  const updateComboSteps = (comboId: string, steps: ComboStep[]): void => {
    updateCombo(comboId, { steps });
  };

  const handleAddCombo = (): void => {
    const name = nextComboDraftName(combos);
    const steps = createInitialComboSteps(
      correctionSettings.presets.map((preset) => preset.id),
      () => crypto.randomUUID(),
    );
    const draft = createComboDraft(crypto.randomUUID(), name, steps);

    updateCombos((currentCombos) => [...currentCombos, draft]);
    setStatus(null);
    setStatusIsError(false);
  };

  const handleRemoveCombo = (comboId: string): void => {
    updateCombos((currentCombos) =>
      currentCombos.filter((combo) => combo.id !== comboId),
    );
    setStatus(null);
    setStatusIsError(false);
  };

  const handleMoveComboStep = (
    combo: ComboPreset,
    stepIndex: number,
    direction: ComboStepDirection,
  ): void => {
    updateComboSteps(combo.id, moveComboStep(combo.steps, stepIndex, direction));
  };

  const handleAddComboStep = (combo: ComboPreset): void => {
    const defaultPresetId = correctionSettings.presets[0]?.id ?? "";
    updateComboSteps(
      combo.id,
      addComboStep(combo.steps, createComboStep(crypto.randomUUID(), defaultPresetId)),
    );
  };

  const handleRemoveComboStep = (combo: ComboPreset, stepIndex: number): void => {
    updateComboSteps(combo.id, removeComboStep(combo.steps, stepIndex));
  };

  const handleComboStepPresetChange = (
    combo: ComboPreset,
    stepIndex: number,
    presetId: string,
  ): void => {
    updateComboSteps(combo.id, setComboStepPreset(combo.steps, stepIndex, presetId));
  };

  const handleComboStepInlineInputChange = (
    combo: ComboPreset,
    stepIndex: number,
    inlineInput: string,
  ): void => {
    updateComboSteps(
      combo.id,
      setComboStepInlineInput(combo.steps, stepIndex, inlineInput),
    );
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Form validation: name + systemPrompt fields must be non-empty.
    const formError = validateFormFields(correctionSettings);
    if (formError) {
      setStatusIsError(true);
      setStatus(wrappedError({ kind: "message", message: formError }));
      return;
    }

    // Blocks Save while ANY combo has a validateCombo error — every error for
    // every invalid combo is already on screen inline, so this banner only
    // needs to point at them, not repeat them.
    if (hasBlockingComboErrors(comboErrorsById)) {
      setStatusIsError(true);
      setStatus(plainStatus("settings.correction.combos.saveBlocked"));
      return;
    }

    // Every hotkey: presets, combos, app keybindings, reserved cancel chord.
    const latestKeyBindings = await window.electronAPI.getKeyBindings();
    const conflict = validateHotkeys(
      correctionSettings.presets,
      latestKeyBindings,
      correctionSettings.combos,
    );
    if (conflict) {
      setStatusIsError(true);
      setStatus(
        wrappedError(
          messageLabel("settings.correction.hotkeyConflict", {
            hotkey: conflict.hotkey,
            presetOrKey: conflict.presetOrKey,
            conflictsWith: conflict.conflictsWith,
          }),
        ),
      );
      return;
    }

    setStatusIsError(false);
    setStatus(plainStatus("settings.correction.saving"));

    const result =
      await window.electronAPI.setCorrectSettings(correctionSettings);

    if (result.success) {
      setStatusIsError(false);
      setStatus(plainStatus("settings.correction.saved"));
      setTimeout(() => setStatus(null), 2000);
      return;
    }

    setStatusIsError(true);
    setStatus(plainStatus("settings.correction.saveError"));
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-card-foreground">
        {t("settings.correction.loading")}
      </div>
    );
  }

  if (!activePreset) {
    return (
      <div className="p-8 text-center text-card-foreground">
        {t("settings.correction.noPresets")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <div className="rounded-lg border border-card-control-border bg-card/60 p-4 text-sm text-card-foreground">
        {t("settings.correction.hotkeyInfo")}
      </div>

      <div className="grid gap-4 sm:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-card-control-border bg-card/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("settings.correction.presetsHeading")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("settings.correction.presetsHint")}
              </p>
            </div>
            <Button
              onClick={handleAddPreset}
              className="h-9 rounded-md px-3 py-0 text-xs font-semibold"
            >
              {t("settings.correction.addPreset")}
            </Button>
          </div>

          <ul className="flex flex-col gap-2">
            {correctionSettings.presets.map((preset) => {
              const isSelected = preset.id === activePreset.id;

              return (
                <li key={preset.id}>
                  <Button
                    type="button"
                    variant={isSelected ? "primary" : "outline"}
                    onClick={() =>
                      setCorrectionSettings((current) => ({
                        ...current,
                        selectedPresetId: preset.id,
                      }))
                    }
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                      isSelected
                        ? "border-primary"
                        : "border-card-control-border bg-background/40 hover:border-ring hover:bg-card"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          title={preset.name}
                          className={`truncate text-sm font-medium ${
                            isSelected ? "text-inherit" : "text-foreground"
                          }`}
                        >
                          {preset.name}
                        </p>
                        <PresetHotkeyChips
                          hotkey={preset.hotkey}
                          selected={isSelected}
                          emptyLabel={t("settings.correction.noHotkeyAssigned")}
                        />
                      </div>
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-1 text-[11px] text-card-foreground">
                        {preset.isBuiltIn
                          ? t("settings.correction.badge.builtIn")
                          : t("settings.correction.badge.custom")}
                      </span>
                    </div>
                  </Button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="rounded-lg border border-card-control-border bg-card/70 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {activePreset.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("settings.correction.configureHint")}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDuplicatePreset}
                className="h-9 rounded-md border border-card-control-border px-3 text-xs font-semibold text-card-foreground transition-colors hover:border-ring hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {t("settings.correction.duplicate")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleResetBuiltIn}
                disabled={!activePreset.isBuiltIn}
                className="h-9 rounded-md border border-card-control-border px-3 text-xs font-semibold transition-colors hover:border-ring disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {t("settings.correction.resetBuiltIn")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeletePreset}
                disabled={activePreset.isBuiltIn}
                className="h-9 rounded-md border border-destructive/50 px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive motion-reduce:transition-none"
              >
                {t("common.delete")}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="preset-name"
                className="text-sm text-card-foreground"
              >
                {t("settings.correction.presetName")}
              </label>
              <input
                id="preset-name"
                type="text"
                value={activePreset.name}
                onChange={(event) =>
                  updatePreset(activePreset.id, { name: event.target.value })
                }
                className="h-10 rounded-md border border-control-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="preset-hotkey"
                className="text-sm text-card-foreground"
              >
                {t("settings.correction.hotkeyLabel")}
              </label>
              <input
                id="preset-hotkey"
                type="text"
                value={activePreset.hotkey}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" || event.key === "Delete") {
                    event.preventDefault();
                    updatePreset(activePreset.id, { hotkey: "" });
                    return;
                  }

                  updatePreset(activePreset.id, {
                    hotkey: captureHotkey(event),
                  });
                }}
                placeholder={t("settings.hotkeys.pressShortcut")}
                readOnly
                className="h-10 rounded-md border border-control-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => updatePreset(activePreset.id, { hotkey: "" })}
                className="self-start rounded-md border border-card-control-border px-3 py-2 text-xs font-semibold text-card-foreground transition-colors hover:border-ring hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {t("settings.correction.clearHotkey")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("settings.correction.hotkeyHint")}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <ModelSelect
              persistSelection={false}
              selectedModelId={activePreset.model}
              onChange={(modelId) =>
                updatePreset(activePreset.id, { model: modelId })
              }
            />
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <ReasoningEffortSlider
              value={activePreset.reasoning}
              inheritFrom={globalReasoningEffort}
              onChange={(reasoning) =>
                updatePreset(activePreset.id, { reasoning })
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                className="rounded-md px-2 py-1 text-xs text-primary"
                onClick={() =>
                  updatePreset(activePreset.id, {
                    reasoning: "provider-default",
                  })
                }
              >
                {t("settings.correction.reasoning.useGlobal")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.correction.reasoning.hint")}
            </p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="preset-output-mode"
                className="text-sm text-card-foreground"
              >
                {t("settings.correction.outputMode.label")}
              </label>
              <Select
                id="preset-output-mode"
                value={activePreset.outputMode ?? "inherit"}
                onChange={(event) =>
                  updatePreset(activePreset.id, {
                    outputMode: event.target
                      .value as CorrectionPreset["outputMode"],
                  })
                }
                className="h-10 px-3"
              >
                <option value="inherit">
                  {t("settings.correction.outputMode.inherit")}
                </option>
                <option value="paste">
                  {t("settings.correction.outputMode.paste")}
                </option>
                <option value="popup">
                  {t("settings.correction.outputMode.popup")}
                </option>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settings.correction.outputMode.hint")}
              </p>
            </div>

            {activePreset.requiresInput && (
              <div className="flex flex-col gap-2">
                <Checkbox
                  name="preset-markdown-output"
                  checked={activePreset.markdownOutput ?? false}
                  onChange={(markdownOutput) =>
                    updatePreset(activePreset.id, { markdownOutput })
                  }
                  label={t("settings.correction.markdownOutput.label")}
                  className="text-card-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.correction.markdownOutput.hint")}
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label
              htmlFor="system-prompt"
              className="text-sm text-card-foreground"
            >
              {t("settings.correction.systemPrompt")}
            </label>
            <textarea
              id="system-prompt"
              value={activePreset.systemPrompt}
              onChange={(event) =>
                updatePreset(activePreset.id, {
                  systemPrompt: event.target.value,
                })
              }
              rows={16}
              className="min-h-72 rounded-md border border-control-border bg-secondary p-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </section>
      </div>

      <div className="rounded-lg border border-card-control-border bg-card/70 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {t("settings.correction.combos.heading")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("settings.correction.combos.hint")}
            </p>
          </div>
          <Button
            type="button"
            onClick={handleAddCombo}
            className="h-9 rounded-md px-3 py-0 text-xs font-semibold"
          >
            {t("settings.correction.combos.addCombo")}
          </Button>
        </div>

        {combos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.correction.combos.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {combos.map((combo) => {
              const fieldMessages = mapComboErrorsToFieldMessages(
                comboErrorsById.get(combo.id) ?? [],
                combo,
                comboStepPresets,
              );

              // Save-time cost/provider estimate (risk 5 + 6) — recomputed
              // per render, not memoized: at most 5 steps, cheap arithmetic
              // plus a fuzzy price lookup, and it must track every edit to
              // this combo's steps or presets' models immediately.
              const estimate = estimateCombo({
                steps: combo.steps,
                presetsById: comboEstimatePresetsById,
                globalDefaultModelRef: comboGlobalDefaultModelRef,
                models: comboEstimateModels,
                priceMap: comboEstimatePriceMap,
              });

              // Sub-cent "ok" combos (the common case at the 800-char
              // baseline) must not format identically to a genuine "zero" —
              // `resolveComboCostDisplay` carries the same min/max
              // fraction-digit rule `historyCost.ts` already enforces for
              // history rows, so this is `formatNumber` driven by that
              // resolved precision rather than a bare `formatCurrency` call
              // (which is fixed at 2 digits and collapses both to "$0.00").
              const costAmountLabel = (() => {
                const display = resolveComboCostDisplay(estimate.cost);
                if (display.kind === "na") return "";
                return formatNumber(display.valueUsd, {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: display.minimumFractionDigits,
                  maximumFractionDigits: display.maximumFractionDigits,
                });
              })();

              return (
                <li
                  key={combo.id}
                  className="rounded-lg border border-card-control-border bg-background/40 p-3"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-1 flex-col gap-1">
                      <label
                        htmlFor={`combo-${combo.id}-name`}
                        className="text-sm text-card-foreground"
                      >
                        {t("settings.correction.combos.nameLabel")}
                      </label>
                      <input
                        id={`combo-${combo.id}-name`}
                        type="text"
                        value={combo.name}
                        onChange={(event) =>
                          updateCombo(combo.id, { name: event.target.value })
                        }
                        className="h-10 max-w-sm rounded-md border border-control-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      {fieldMessages.nameErrors.map((message, index) => (
                        <p
                          key={index}
                          className="text-xs text-destructive"
                          role="alert"
                        >
                          {tm(message)}
                        </p>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => handleRemoveCombo(combo.id)}
                      className="h-9 rounded-md border border-destructive/50 px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive motion-reduce:transition-none"
                    >
                      {t("common.delete")}
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor={`combo-${combo.id}-hotkey`}
                        className="text-sm text-card-foreground"
                      >
                        {t("settings.correction.hotkeyLabel")}
                      </label>
                      <input
                        id={`combo-${combo.id}-hotkey`}
                        type="text"
                        value={combo.hotkey}
                        onKeyDown={(event) => {
                          if (event.key === "Backspace" || event.key === "Delete") {
                            event.preventDefault();
                            updateCombo(combo.id, { hotkey: "" });
                            return;
                          }

                          updateCombo(combo.id, { hotkey: captureHotkey(event) });
                        }}
                        placeholder={t("settings.hotkeys.pressShortcut")}
                        readOnly
                        className="h-10 rounded-md border border-control-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => updateCombo(combo.id, { hotkey: "" })}
                        className="self-start rounded-md border border-card-control-border px-3 py-2 text-xs font-semibold text-card-foreground transition-colors hover:border-ring hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                      >
                        {t("settings.correction.clearHotkey")}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.correction.combos.hotkeyHint")}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor={`combo-${combo.id}-output-mode`}
                        className="text-sm text-card-foreground"
                      >
                        {t("settings.correction.outputMode.label")}
                      </label>
                      <Select
                        id={`combo-${combo.id}-output-mode`}
                        value={combo.outputMode ?? "inherit"}
                        onChange={(event) =>
                          updateCombo(combo.id, {
                            outputMode: event.target
                              .value as ComboPreset["outputMode"],
                          })
                        }
                        className="h-10 px-3"
                      >
                        <option value="inherit">
                          {t("settings.correction.outputMode.inherit")}
                        </option>
                        <option value="paste">
                          {t("settings.correction.outputMode.paste")}
                        </option>
                        <option value="popup">
                          {t("settings.correction.outputMode.popup")}
                        </option>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.correction.combos.outputModeHint")}
                      </p>
                      <Checkbox
                        name={`combo-${combo.id}-markdown-output`}
                        checked={combo.markdownOutput ?? false}
                        onChange={(markdownOutput) =>
                          updateCombo(combo.id, { markdownOutput })
                        }
                        label={t("settings.correction.markdownOutput.label")}
                        className="text-card-foreground"
                      />
                    </div>
                  </div>

                  {/* Cost/provider transparency (risk 5 + 6): the provider
                      list is the headline — three steps on three providers
                      sends the selection to three vendors from one hotkey,
                      and that has to be visible here, not something the user
                      infers from three separate preset screens. */}
                  <div className="mt-4 flex flex-col gap-2 rounded-md border border-card-control-border/60 bg-secondary/40 p-3 text-xs text-muted-foreground">
                    <p>
                      {t("settings.correction.combos.estimate.tokens", {
                        baselineChars: COMBO_ESTIMATE_BASELINE_CHARS,
                        tokens: estimate.totalTokens,
                      })}
                    </p>
                    <p>
                      {estimate.cost.status === "na"
                        ? t("settings.correction.combos.estimate.costNa")
                        : t("settings.correction.combos.estimate.cost", {
                            baselineChars: COMBO_ESTIMATE_BASELINE_CHARS,
                            cost: costAmountLabel,
                          })}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>
                        {t("settings.correction.combos.estimate.providersLabel")}
                      </span>
                      {estimate.providers.length === 0 ? (
                        <span>
                          {t(
                            "settings.correction.combos.estimate.providersUnknown",
                          )}
                        </span>
                      ) : (
                        <ul className="inline-flex flex-wrap items-center gap-1">
                          {estimate.providers.map((provider) => (
                            <li
                              key={provider}
                              className="inline-block rounded-full border border-card-control-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground"
                            >
                              {t(PROVIDER_LABEL_KEYS[provider])}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {estimate.hasUnresolvedProvider && (
                      <p>
                        {t(
                          "settings.correction.combos.estimate.providersUnresolvedHint",
                        )}
                      </p>
                    )}
                    {estimate.hasMultipleProviders && (
                      <p className="font-medium text-destructive" role="alert">
                        {t("settings.correction.combos.estimate.warningProviders")}
                      </p>
                    )}
                    {estimate.exceedsWarningThreshold && (
                      <p className="font-medium text-destructive" role="alert">
                        {t("settings.correction.combos.estimate.warningTokens")}
                      </p>
                    )}
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-foreground">
                        {t("settings.correction.combos.stepsHeading")}
                      </h4>
                      <span className="text-xs text-muted-foreground">
                        {t("settings.correction.combos.stepCountHint", {
                          min: COMBO_MIN_STEPS,
                          max: COMBO_MAX_STEPS,
                        })}
                      </span>
                    </div>

                    {fieldMessages.stepCountErrors.map((message, index) => (
                      <p
                        key={index}
                        className="mb-2 text-xs text-destructive"
                        role="alert"
                      >
                        {tm(message)}
                      </p>
                    ))}

                    <ul className="flex flex-col gap-2">
                      {combo.steps.map((step, stepIndex) => {
                        const needsInlineInput = comboStepNeedsInlineInput(
                          step,
                          comboStepPresets,
                        );
                        const stepErrors = fieldMessages.stepErrorsById[step.id] ?? [];

                        return (
                          <li
                            key={step.id}
                            className="flex flex-col gap-2 rounded-md border border-card-control-border/60 p-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">
                                {stepIndex + 1}.
                              </span>
                              <Select
                                aria-label={t(
                                  "settings.correction.combos.stepPresetLabel",
                                  { number: stepIndex + 1 },
                                )}
                                value={step.presetId}
                                onChange={(event) =>
                                  handleComboStepPresetChange(
                                    combo,
                                    stepIndex,
                                    event.target.value,
                                  )
                                }
                                className="h-9 flex-1 px-2 text-sm"
                              >
                                {correctionSettings.presets.map((preset) => (
                                  <option key={preset.id} value={preset.id}>
                                    {preset.name}
                                  </option>
                                ))}
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                aria-label={t("settings.correction.combos.moveStepUp")}
                                disabled={
                                  !canMoveComboStep(combo.steps, stepIndex, "up")
                                }
                                onClick={() =>
                                  handleMoveComboStep(combo, stepIndex, "up")
                                }
                                className="h-9 w-9 shrink-0 rounded-md px-0 text-xs font-semibold"
                              >
                                {"↑"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                aria-label={t(
                                  "settings.correction.combos.moveStepDown",
                                )}
                                disabled={
                                  !canMoveComboStep(combo.steps, stepIndex, "down")
                                }
                                onClick={() =>
                                  handleMoveComboStep(combo, stepIndex, "down")
                                }
                                className="h-9 w-9 shrink-0 rounded-md px-0 text-xs font-semibold"
                              >
                                {"↓"}
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                aria-label={t("settings.correction.combos.removeStep")}
                                onClick={() => handleRemoveComboStep(combo, stepIndex)}
                                className="h-9 w-9 shrink-0 rounded-md px-0 text-xs font-semibold"
                              >
                                {"×"}
                              </Button>
                            </div>

                            {needsInlineInput && (
                              <div className="ml-7 flex flex-col gap-1">
                                <label
                                  htmlFor={`combo-${combo.id}-step-${step.id}-input`}
                                  className="text-xs text-muted-foreground"
                                >
                                  {t("settings.correction.combos.inlineInputLabel")}
                                </label>
                                <input
                                  id={`combo-${combo.id}-step-${step.id}-input`}
                                  type="text"
                                  value={step.inlineInput ?? ""}
                                  onChange={(event) =>
                                    handleComboStepInlineInputChange(
                                      combo,
                                      stepIndex,
                                      event.target.value,
                                    )
                                  }
                                  placeholder={t(
                                    "settings.correction.combos.inlineInputPlaceholder",
                                  )}
                                  className="h-9 rounded-md border border-control-border bg-secondary px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                              </div>
                            )}

                            {stepErrors.map((message, index) => (
                              <p
                                key={index}
                                className="ml-7 text-xs text-destructive"
                                role="alert"
                              >
                                {tm(message)}
                              </p>
                            ))}
                          </li>
                        );
                      })}
                    </ul>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleAddComboStep(combo)}
                      disabled={!canAddComboStep(combo.steps)}
                      className="mt-2 rounded-md border border-card-control-border px-3 py-2 text-xs font-semibold text-card-foreground transition-colors hover:border-ring hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                    >
                      {t("settings.correction.combos.addStep")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="submit"
          className="h-10 rounded-md px-4 py-0 text-sm font-semibold"
        >
          {t("settings.correction.savePresets")}
        </Button>
      </div>

      {status && (
        <p
          className={`text-sm ${statusIsError ? "text-destructive" : "text-success"}`}
          role="status"
        >
          {resolveStatus(status, t, tm, tl)}
        </p>
      )}
    </form>
  );
};
