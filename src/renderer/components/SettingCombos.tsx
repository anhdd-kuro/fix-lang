import React, { useEffect, useMemo, useState } from "react";
import {
  COMBO_MAX_STEPS,
  COMBO_MIN_STEPS,
} from "~/features/correction/shared/comboValidation";
import { messageLabel } from "~/features/i18n/shared/message";
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
  reorderComboStep,
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
import { captureHotkey } from "./hotkeyCapture";
import { PROVIDER_LABEL_KEYS } from "./modelSelectOptions";
import { SearchableSelect } from "./SearchableSelect";
import {
  plainStatus,
  wrappedError,
  resolveStatus,
  type StatusDescriptor,
} from "./statusDescriptor";
import { validateHotkeys } from "./validateHotkeys";
import { useI18n } from "../i18n/useI18n";
import type {
  ComboPreset,
  ComboStep,
  CorrectionSettings,
  Model,
} from "~/features/providers/store/apiStore";

type ComboOutputMode = NonNullable<ComboPreset["outputMode"]>;
type ComboOutputModeOption = { value: ComboOutputMode; label: string };
type ComboStepPresetOption = { value: string; label: string };

/**
 * One drag, and it belongs to ONE combo. Carrying `comboId` alongside the
 * indices is what stops a step being dropped into a sibling combo's list: a
 * bare index would be meaningless the moment the pointer left its own list,
 * and every row on the tab would read as a valid drop target.
 */
type ComboStepDragState = {
  comboId: string;
  fromIndex: number;
  overIndex: number;
};

/** Custom MIME rather than `text/plain`, so an accidental drop on a text field inserts nothing. */
const COMBO_STEP_DRAG_MIME = "application/x-fixlang-combo-step";

const COMBO_OUTPUT_MODES = [
  { mode: "inherit", labelKey: "settings.correction.outputMode.inherit" },
  { mode: "paste", labelKey: "settings.correction.outputMode.paste" },
  { mode: "popup", labelKey: "settings.correction.outputMode.popup" },
] as const satisfies readonly {
  readonly mode: ComboOutputMode;
  readonly labelKey: string;
}[];

const EMPTY_SETTINGS: CorrectionSettings = {
  presets: [],
  selectedPresetId: "",
};

/**
 * Combos get their own Settings tab rather than a section of Transform, but
 * they still live in the SAME `settingsCorrect` store node as the presets they
 * chain. Two consequences this component has to honour:
 *
 * - It loads and writes the WHOLE `CorrectionSettings`, presets included. Only
 *   the active tab is mounted, so unsaved Transform edits are already gone by
 *   the time this tab renders — the same thing that happens switching between
 *   any two settings tabs today — but a save here still round-trips the
 *   presets it never edits, which is why it must load them rather than send a
 *   combos-only object.
 * - Hotkey conflict validation spans both. A combo hotkey must be refused when
 *   it collides with a preset hotkey, an app keybinding, or the reserved
 *   `Control+Escape` cancel chord, and `validateHotkeys` needs the presets to
 *   say so.
 */
export const SettingCombos: React.FC = () => {
  const { t, tm, tl, formatNumber } = useI18n();
  const [correctionSettings, setCorrectionSettings] =
    useState<CorrectionSettings>(EMPTY_SETTINGS);
  // Locale-free descriptor — a `useState("")` filled by `t()` at action time
  // freezes the message into whatever locale was active when the action ran.
  const [status, setStatus] = useState<StatusDescriptor | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [comboEstimateModels, setComboEstimateModels] = useState<Model[]>([]);
  const [comboGlobalDefaultModelRef, setComboGlobalDefaultModelRef] =
    useState<string>("");
  const [stepDrag, setStepDrag] = useState<ComboStepDragState | null>(null);

  // `t` changes identity on a locale switch, so it must stay in the deps or
  // the rows keep the previous language.
  const outputModeOptions = useMemo<ComboOutputModeOption[]>(
    () =>
      COMBO_OUTPUT_MODES.map(({ mode, labelKey }) => ({
        value: mode,
        label: t(labelKey),
      })),
    [t],
  );

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

  // Preset names are user-authored, so unlike `outputModeOptions` these labels
  // carry no `t` dependency — a locale switch does not rename a preset.
  const comboStepPresetOptions = useMemo<ComboStepPresetOption[]>(
    () =>
      correctionSettings.presets.map((preset) => ({
        value: preset.id,
        label: preset.name,
      })),
    [correctionSettings.presets],
  );

  // Runs `validateCombo` for EVERY combo, not just the one being edited, so
  // Save stays blocked as long as any combo is invalid and every error for
  // every invalid combo is on screen at once.
  const comboErrorsById = useMemo(
    () => collectComboErrors(combos, correctionSettings.presets),
    [combos, correctionSettings.presets],
  );

  // Cost/provider transparency inputs — a preset-model lookup and a price map,
  // both derived once per settings/model change rather than rebuilt per row.
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
      const [settings, modelsResult, defaultModelRef] = await Promise.all([
        window.electronAPI.getCorrectSettings(),
        // Cached-only (no refetch): the estimate needs whatever `ModelSelect`
        // has already fetched for pricing, not a fresh network round-trip on
        // every Settings load.
        window.electronAPI.fetchAIModels?.(false) ?? Promise.resolve(undefined),
        window.electronAPI.getSelectedModel?.() ?? Promise.resolve(""),
      ]);
      setCorrectionSettings(settings);
      if (modelsResult?.success && modelsResult.models) {
        setComboEstimateModels(modelsResult.models);
      }
      setComboGlobalDefaultModelRef(defaultModelRef ?? "");
    } catch (error) {
      console.error("Failed to load combos:", error);
      setCorrectionSettings(EMPTY_SETTINGS);
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

  const updateCombos = (
    updater: (combos: ComboPreset[]) => ComboPreset[],
  ): void => {
    setCorrectionSettings((current) => ({
      ...current,
      combos: updater(current.combos ?? []),
    }));
  };

  const updateCombo = (
    comboId: string,
    updates: Partial<ComboPreset>,
  ): void => {
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
    const steps = createInitialComboSteps(correctionSettings.presets, () =>
      crypto.randomUUID(),
    );
    const draft = createComboDraft(crypto.randomUUID(), name, steps);

    updateCombos((currentCombos) => [...currentCombos, draft]);
  };

  const handleRemoveCombo = (comboId: string): void => {
    updateCombos((currentCombos) =>
      currentCombos.filter((combo) => combo.id !== comboId),
    );
  };

  const handleMoveComboStep = (
    combo: ComboPreset,
    stepIndex: number,
    direction: ComboStepDirection,
  ): void => {
    updateComboSteps(
      combo.id,
      moveComboStep(combo.steps, stepIndex, direction),
    );
  };

  const handleComboStepDragStart = (
    combo: ComboPreset,
    stepIndex: number,
    event: React.DragEvent<HTMLElement>,
  ): void => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(COMBO_STEP_DRAG_MIME, combo.steps[stepIndex].id);
    setStepDrag({ comboId: combo.id, fromIndex: stepIndex, overIndex: stepIndex });
  };

  const isOwnStepDrag = (comboId: string): boolean =>
    stepDrag !== null && stepDrag.comboId === comboId;

  const handleComboStepDragOver = (
    combo: ComboPreset,
    stepIndex: number,
    event: React.DragEvent<HTMLElement>,
  ): void => {
    // Without `preventDefault` the browser never fires `drop`; withholding it
    // for a foreign combo is what makes those rows refuse the drop outright.
    if (!isOwnStepDrag(combo.id)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setStepDrag((current) =>
      current === null || current.overIndex === stepIndex
        ? current
        : { ...current, overIndex: stepIndex },
    );
  };

  const handleComboStepDrop = (
    combo: ComboPreset,
    stepIndex: number,
    event: React.DragEvent<HTMLElement>,
  ): void => {
    if (!isOwnStepDrag(combo.id) || stepDrag === null) return;

    event.preventDefault();
    updateComboSteps(
      combo.id,
      reorderComboStep(combo.steps, stepDrag.fromIndex, stepIndex),
    );
    setStepDrag(null);
  };

  const handleComboStepDragEnd = (): void => {
    setStepDrag(null);
  };

  const handleAddComboStep = (combo: ComboPreset): void => {
    const defaultPresetId = correctionSettings.presets[0]?.id ?? "";
    updateComboSteps(
      combo.id,
      addComboStep(
        combo.steps,
        createComboStep(crypto.randomUUID(), defaultPresetId),
      ),
    );
  };

  const handleRemoveComboStep = (
    combo: ComboPreset,
    stepIndex: number,
  ): void => {
    updateComboSteps(combo.id, removeComboStep(combo.steps, stepIndex));
  };

  const handleComboStepPresetChange = (
    combo: ComboPreset,
    stepIndex: number,
    presetId: string,
  ): void => {
    updateComboSteps(
      combo.id,
      setComboStepPreset(combo.steps, stepIndex, presetId),
    );
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

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-4 p-4">
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
                      <SearchableSelect<PresetOutputModeOption>
                        id={`combo-${combo.id}-output-mode-control`}
                        inputId={`combo-${combo.id}-output-mode`}
                        className="w-full text-sm"
                        value={
                          outputModeOptions.find(
                            (option) =>
                              option.value === (combo.outputMode ?? "inherit"),
                          ) ?? null
                        }
                        options={outputModeOptions}
                        noOptionsMessage={t("common.select.noOptions")}
                        onChange={(option) => {
                          if (option) {
                            updateCombo(combo.id, {
                              outputMode: option.value,
                            });
                          }
                        }}
                      />
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
                        const isDraggedStep =
                          stepDrag?.comboId === combo.id &&
                          stepDrag.fromIndex === stepIndex;
                        const isDropTarget =
                          stepDrag?.comboId === combo.id &&
                          stepDrag.overIndex === stepIndex &&
                          stepDrag.fromIndex !== stepIndex;

                        return (
                          <li
                            key={step.id}
                            onDragOver={(event) =>
                              handleComboStepDragOver(combo, stepIndex, event)
                            }
                            onDrop={(event) =>
                              handleComboStepDrop(combo, stepIndex, event)
                            }
                            className={`flex flex-col gap-2 rounded-md border p-2 transition-colors motion-reduce:transition-none ${
                              isDropTarget
                                ? "border-ring bg-secondary/40"
                                : "border-card-control-border/60"
                            } ${isDraggedStep ? "opacity-60" : ""}`}
                          >
                            <div className="flex items-center gap-2">
                              {/* Mouse-only affordance: the arrow buttons below
                                  are the keyboard path, so this handle stays out
                                  of the tab order. `aria-hidden` and `tabIndex`
                                  must move together — a focusable aria-hidden
                                  control is its own violation — and `title`
                                  keeps the tooltip for the mouse users it is for. */}
                              <Button
                                type="button"
                                variant="ghost"
                                draggable
                                aria-hidden="true"
                                tabIndex={-1}
                                title={t("settings.correction.combos.dragStep", {
                                  number: stepIndex + 1,
                                })}
                                onDragStart={(event) =>
                                  handleComboStepDragStart(combo, stepIndex, event)
                                }
                                onDragEnd={handleComboStepDragEnd}
                                className="h-9 w-6 shrink-0 cursor-grab rounded-md px-0 text-sm text-muted-foreground active:cursor-grabbing"
                              >
                                {"⠿"}
                              </Button>
                              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">
                                {stepIndex + 1}.
                              </span>
                              <SearchableSelect<ComboStepPresetOption>
                                ariaLabel={t(
                                  "settings.correction.combos.stepPresetLabel",
                                  { number: stepIndex + 1 },
                                )}
                                className="min-w-0 flex-1 text-sm"
                                value={
                                  comboStepPresetOptions.find(
                                    (option) => option.value === step.presetId,
                                  ) ?? null
                                }
                                options={comboStepPresetOptions}
                                noOptionsMessage={t("common.select.noOptions")}
                                onChange={(option) => {
                                  if (option) {
                                    handleComboStepPresetChange(
                                      combo,
                                      stepIndex,
                                      option.value,
                                    );
                                  }
                                }}
                              />
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
                              <div className="ml-15 flex flex-col gap-1">
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
                                className="ml-15 text-xs text-destructive"
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
