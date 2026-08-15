import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  buildComboTabs,
  canAddComboStep,
  collectComboErrors,
  comboStepNeedsInlineInput,
  comboTabIndexAfterMove,
  comboTabMoveForKey,
  createComboDraft,
  createComboStep,
  createInitialComboSteps,
  hasBlockingComboErrors,
  mapComboErrorsToFieldMessages,
  moveComboStep,
  nextComboDraftName,
  reconcileSelectedComboId,
  removeComboStep,
  reorderComboStepById,
  selectedComboIdAfterRemoval,
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
import { Input } from "./Input";
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
 * step id (not a start index) is what stops a step being dropped into a
 * sibling combo's list AND what keeps the drop moving the grabbed step after
 * Remove or ArrowUp/ArrowDown reshuffles the list mid-drag. A bare index would
 * be stale the moment the pointer left its own list, and every row on the tab
 * would read as a valid drop target.
 */
type ComboStepDragState = {
  comboId: string;
  stepId: string;
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
  // Selection is tracked by combo ID, never by index: a delete or a reorder
  // would silently move an index onto a different combo.
  const [selectedComboId, setSelectedComboId] = useState<string | null>(null);
  // Inline tab rename. `renameDraft` is user data, not a `t()` result, so it
  // is safe in `useState` — unlike `status`, which stays a descriptor.
  const [renamingComboId, setRenamingComboId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Escape must revert, but tearing down the input can also fire blur, which
  // commits. This flag is what makes those two paths mutually exclusive.
  const renameCancelledRef = useRef(false);
  const tabButtonsRef = useRef(new Map<string, HTMLButtonElement>());

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

  // Tab strip descriptors. Labels carry no `t` dependency — a `Label` stays
  // locale-free until `tl()` resolves it during render.
  const comboTabs = useMemo(
    () => buildComboTabs(combos, comboErrorsById),
    [combos, comboErrorsById],
  );

  // Only ever the combo that still exists: a stale id must never render a
  // blank panel, even in the render between a mutation and its reconcile.
  const activeCombo =
    combos.find((combo) => combo.id === selectedComboId) ?? combos[0] ?? null;

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
      // A reload can drop the selected combo (profile switch, an edit saved
      // from another window). Reconcile rather than let a stale id render an
      // empty tab body.
      setSelectedComboId((current) =>
        reconcileSelectedComboId(settings.combos ?? [], current),
      );
      if (modelsResult?.success && modelsResult.models) {
        setComboEstimateModels(modelsResult.models);
      }
      setComboGlobalDefaultModelRef(defaultModelRef ?? "");
    } catch (error) {
      console.error("Failed to load combos:", error);
      setCorrectionSettings(EMPTY_SETTINGS);
      setSelectedComboId(null);
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
    const steps = createInitialComboSteps(
      correctionSettings.presets.map((preset) => preset.id),
      () => crypto.randomUUID(),
    );
    const draft = createComboDraft(crypto.randomUUID(), name, steps);

    updateCombos((currentCombos) => [...currentCombos, draft]);
    setSelectedComboId(draft.id);
  };

  const handleRemoveCombo = (comboId: string): void => {
    // Resolved against the list as it stands BEFORE the removal, so a deleted
    // selected tab lands on a neighbour instead of snapping back to the first.
    setSelectedComboId((current) =>
      selectedComboIdAfterRemoval(combos, comboId, current),
    );
    updateCombos((currentCombos) =>
      currentCombos.filter((combo) => combo.id !== comboId),
    );
    setRenamingComboId((current) => (current === comboId ? null : current));
    setStepDrag((current) =>
      current !== null && current.comboId === comboId ? null : current,
    );
    tabButtonsRef.current.delete(comboId);
  };

  /**
   * Set when a rename ends by KEYBOARD (Enter/Escape), naming the tab that
   * should take focus back. A rename ended by clicking elsewhere leaves it
   * null: the user has already chosen where focus goes, and yanking it back
   * to the tab would fight them.
   */
  const restoreFocusComboIdRef = useRef<string | null>(null);

  /**
   * Returns focus to the tab once the editor has actually unmounted. Doing it
   * inside the commit handler instead would focus the button while the input
   * is still mounted, and the resulting `blur` would re-enter the commit.
   */
  useEffect(() => {
    if (renamingComboId !== null) return;
    const comboId = restoreFocusComboIdRef.current;
    if (comboId === null) return;
    restoreFocusComboIdRef.current = null;
    tabButtonsRef.current.get(comboId)?.focus();
  }, [renamingComboId]);

  const beginRenameCombo = (combo: ComboPreset): void => {
    renameCancelledRef.current = false;
    setRenameDraft(combo.name);
    setRenamingComboId(combo.id);
  };

  /** Commits through the SAME `updateCombo` path as the Name field — one source of truth. */
  const commitRenameCombo = (comboId: string): void => {
    setRenamingComboId(null);
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }
    updateCombo(comboId, { name: renameDraft });
  };

  const handleRenameKeyDown = (
    comboId: string,
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      restoreFocusComboIdRef.current = comboId;
      commitRenameCombo(comboId);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      restoreFocusComboIdRef.current = comboId;
      renameCancelledRef.current = true;
      setRenamingComboId(null);
    }
  };

  // Stable identity so React only runs it on mount/unmount — an inline ref
  // callback re-runs every render and would re-select the text on each keystroke.
  const focusRenameInput = useCallback((node: HTMLInputElement | null) => {
    if (node === null) return;
    node.focus();
    node.select();
  }, []);

  const registerTabButton = (
    comboId: string,
    node: HTMLButtonElement | null,
  ): void => {
    if (node === null) {
      tabButtonsRef.current.delete(comboId);
      return;
    }
    tabButtonsRef.current.set(comboId, node);
  };

  /** Roving focus: Left/Right wrap around the strip, Home/End jump to its ends. */
  const handleTabKeyDown = (
    tabIndex: number,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    const move = comboTabMoveForKey(event.key);
    if (move === null) return;

    event.preventDefault();
    const nextTab =
      comboTabs[comboTabIndexAfterMove(tabIndex, comboTabs.length, move)];
    if (nextTab === undefined) return;

    setSelectedComboId(nextTab.comboId);
    tabButtonsRef.current.get(nextTab.comboId)?.focus();
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
    const stepId = combo.steps[stepIndex].id;
    event.dataTransfer.setData(COMBO_STEP_DRAG_MIME, stepId);
    setStepDrag({ comboId: combo.id, stepId, overIndex: stepIndex });
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
    // Prefer the MIME payload (set at drag start); fall back to React state if
    // a browser withholds getData outside drop — either way, resolve by id so
    // a mid-drag Remove/ArrowUp/ArrowDown cannot make fromIndex point at a
    // different step.
    const draggedStepId =
      event.dataTransfer.getData(COMBO_STEP_DRAG_MIME) || stepDrag.stepId;
    updateComboSteps(
      combo.id,
      reorderComboStepById(combo.steps, draggedStepId, stepIndex),
    );
    setStepDrag(null);
  };

  const handleComboStepDragEnd = (): void => {
    setStepDrag(null);
  };

  const handleComboStepDragHandleKeyDown = (
    combo: ComboPreset,
    stepIndex: number,
    event: React.KeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      handleMoveComboStep(combo, stepIndex, "up");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      handleMoveComboStep(combo, stepIndex, "down");
    }
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
    const removedStepId = combo.steps[stepIndex]?.id;
    updateComboSteps(combo.id, removeComboStep(combo.steps, stepIndex));
    setStepDrag((current) =>
      current !== null &&
      current.comboId === combo.id &&
      current.stepId === removedStepId
        ? null
        : current,
    );
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

        {activeCombo === null ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.correction.combos.empty")}
          </p>
        ) : (
          <>
            {/* One tab per combo. An invalid combo on a hidden tab still
                blocks Save, so its tab carries an error marker — otherwise the
                Save-blocked banner would point at errors nobody can see. */}
            <div
              role="tablist"
              aria-label={t("settings.correction.combos.tabsAriaLabel")}
              className="mb-2 flex flex-wrap items-center gap-2"
            >
              {comboTabs.map((tab, tabIndex) => {
                const isActive = tab.comboId === activeCombo.id;

                return (
                  <Button
                    key={tab.comboId}
                    ref={(node) => registerTabButton(tab.comboId, node)}
                    type="button"
                    variant={isActive ? "primary" : "ghost"}
                    role="tab"
                    id={`combo-tab-${tab.comboId}`}
                    aria-selected={isActive}
                    aria-controls={`combo-panel-${tab.comboId}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setSelectedComboId(tab.comboId)}
                    onDoubleClick={() => {
                      const combo = combos.find(
                        (candidate) => candidate.id === tab.comboId,
                      );
                      if (combo) beginRenameCombo(combo);
                    }}
                    onKeyDown={(event) => handleTabKeyDown(tabIndex, event)}
                    className={`flex h-9 items-center gap-1.5 rounded-md px-3 py-0 text-xs font-semibold ${
                      isActive
                        ? "shadow"
                        : "border border-card-control-border text-card-foreground hover:bg-secondary"
                    }`}
                  >
                    <span className="whitespace-nowrap">{tl(tab.label)}</span>
                    {tab.hasErrors && (
                      <>
                        <span aria-hidden="true" className="text-destructive">
                          {"⚠"}
                        </span>
                        <span className="sr-only">
                          {t("settings.correction.combos.tabHasErrors")}
                        </span>
                      </>
                    )}
                  </Button>
                );
              })}
            </div>

            {/* The rename editor sits OUTSIDE the tablist on purpose. Swapping
                it in for the tab button left the tablist with no selected,
                tabbable tab and pointed the panel's `aria-labelledby` at an id
                that no longer existed. Here the tab keeps its semantics and
                its focus target while the name is edited, and arrow keys still
                edit text rather than switching tabs because focus is on an
                input outside the roving strip. */}
            {renamingComboId !== null && (
              <Input
                ref={focusRenameInput}
                type="text"
                value={renameDraft}
                aria-label={t("settings.correction.combos.renameLabel")}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => handleRenameKeyDown(renamingComboId, event)}
                onBlur={() => commitRenameCombo(renamingComboId)}
                className="mb-2 h-9 w-60 py-0"
              />
            )}

            <p className="mb-3 text-xs text-muted-foreground">
              {t("settings.correction.combos.renameHint")}
            </p>

            {/* Exactly one panel is mounted — the selected combo's. Every
                other combo is still validated by `comboErrorsById`, so an
                unmounted one can (and must) keep blocking Save. */}
            {combos
              .filter((combo) => combo.id === activeCombo.id)
              .map((combo) => {
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
                <div
                  key={combo.id}
                  id={`combo-panel-${combo.id}`}
                  role="tabpanel"
                  aria-labelledby={`combo-tab-${combo.id}`}
                  tabIndex={0}
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
                      <Input
                        id={`combo-${combo.id}-name`}
                        type="text"
                        value={combo.name}
                        onChange={(event) =>
                          updateCombo(combo.id, { name: event.target.value })
                        }
                        className="max-w-sm w-full"
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
                      <Input
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
                        className="w-full"
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
                      <SearchableSelect<ComboOutputModeOption>
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
                              className="inline-block rounded-full border border-card-control-border bg-muted px-2 py-0.5 text-xxs font-semibold text-foreground"
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

                  <div className="mt-4 flex flex-col">
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
                          stepDrag.stepId === step.id;
                        const isDropTarget =
                          stepDrag?.comboId === combo.id &&
                          stepDrag.overIndex === stepIndex &&
                          stepDrag.stepId !== step.id;

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
                              {/* Drag handle is also the keyboard reorder path:
                                  ArrowUp / ArrowDown move the focused step. */}
                              <Button
                                type="button"
                                variant="ghost"
                                draggable
                                aria-label={t("settings.correction.combos.dragStep", {
                                  number: stepIndex + 1,
                                })}
                                title={t("settings.correction.combos.dragStep", {
                                  number: stepIndex + 1,
                                })}
                                onDragStart={(event) =>
                                  handleComboStepDragStart(combo, stepIndex, event)
                                }
                                onDragEnd={handleComboStepDragEnd}
                                onKeyDown={(event) =>
                                  handleComboStepDragHandleKeyDown(
                                    combo,
                                    stepIndex,
                                    event,
                                  )
                                }
                                className="h-9 w-6 shrink-0 cursor-grab rounded-md px-0 text-sm text-muted-foreground active:cursor-grabbing"
                              >
                                {"⠿"}
                              </Button>
                              <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground">
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
                                variant="destructive"
                                aria-label={t("settings.correction.combos.removeStep")}
                                onClick={() => handleRemoveComboStep(combo, stepIndex)}
                                className="h-9 w-9 shrink-0 rounded-md px-0 text-lg font-semibold leading-none"
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
                                <Input
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
                                  className="w-full"
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
                      className="mt-2 w-fit self-start rounded-md border border-card-control-border px-3 py-2 text-xs font-semibold text-card-foreground transition-colors hover:border-ring hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                    >
                      {t("settings.correction.combos.addStep")}
                    </Button>
                  </div>
                </div>
              );
              })}
          </>
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
