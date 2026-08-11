/**
 * @file comboEditorView.ts
 * @description PURE view model for the Settings → Transform combo editor.
 * Every decision the editor makes — step reorder, add/remove, whether a step
 * needs its own inline input, which field a `ComboValidationError` belongs on,
 * and whether Save is blocked — lives here so it is unit-testable without a
 * DOM testing library (this repo has no React Testing Library). The JSX shell
 * in `SettingCorrection.tsx` only renders what these functions return.
 *
 * No Electron or React imports — safe for Vitest without mocks.
 */
import {
  COMBO_MAX_STEPS,
  COMBO_MIN_STEPS,
  validateCombo,
  type ComboValidationError,
} from "~/features/correction/shared/comboValidation";
import { msg, type Message } from "~/features/i18n/shared/message";
import type {
  ComboPreset,
  ComboStep,
  CorrectionPreset,
} from "~/features/providers/store/apiStore";

/** One step in a new combo. Caller supplies `id` so this stays deterministic. */
export const createComboStep = (id: string, presetId: string): ComboStep => ({
  id,
  presetId,
});

/**
 * The two starter steps a freshly-added combo opens with, so it starts closer
 * to valid than an empty list would (`validateCombo`'s step-count rule needs
 * at least `COMBO_MIN_STEPS`). Falls back to repeating the only available
 * preset when the profile has fewer than `COMBO_MIN_STEPS` of them.
 */
export const createInitialComboSteps = (
  availablePresetIds: readonly string[],
  idFactory: () => string,
): ComboStep[] => {
  if (availablePresetIds.length === 0) return [];

  return Array.from({ length: COMBO_MIN_STEPS }, (_unused, index) =>
    createComboStep(
      idFactory(),
      availablePresetIds[index] ??
        availablePresetIds[availablePresetIds.length - 1],
    ),
  );
};

/** A name that does not collide with any existing combo, for the Add-combo default. */
export const nextComboDraftName = (
  combos: readonly Pick<ComboPreset, "name">[],
): string => {
  const taken = new Set(combos.map((combo) => combo.name.trim()));
  let ordinal = combos.length + 1;
  let candidate = `Combo ${String(ordinal)}`;
  while (taken.has(candidate)) {
    ordinal += 1;
    candidate = `Combo ${String(ordinal)}`;
  }
  return candidate;
};

export const createComboDraft = (
  id: string,
  name: string,
  steps: readonly ComboStep[],
): ComboPreset => ({
  id,
  name,
  hotkey: "",
  steps: [...steps],
  schemaVersion: 1,
});

// --- Step reorder -----------------------------------------------------

export type ComboStepDirection = "up" | "down";

export const canMoveComboStep = (
  steps: readonly ComboStep[],
  index: number,
  direction: ComboStepDirection,
): boolean => {
  if (index < 0 || index >= steps.length) return false;
  return direction === "up" ? index > 0 : index < steps.length - 1;
};

/** Swaps the step at `index` with its neighbor. Returns a new array either way. */
export const moveComboStep = (
  steps: readonly ComboStep[],
  index: number,
  direction: ComboStepDirection,
): ComboStep[] => {
  if (!canMoveComboStep(steps, index, direction)) return [...steps];

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  const next = [...steps];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
};

/**
 * Move-to-index, the drag-and-drop counterpart of `moveComboStep`'s neighbor
 * swap: a drop onto a distant row means "put it HERE", so the steps in between
 * close up. Any index outside the list — a drag whose row was removed while it
 * was in flight — is a no-op copy rather than a sparse array, matching every
 * other out-of-range path in this module.
 */
export const reorderComboStep = (
  steps: readonly ComboStep[],
  fromIndex: number,
  toIndex: number,
): ComboStep[] => {
  const isInRange = (index: number): boolean =>
    index >= 0 && index < steps.length;
  if (!isInRange(fromIndex) || !isInRange(toIndex) || fromIndex === toIndex) {
    return [...steps];
  }

  const next = [...steps];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

// --- Step add / remove --------------------------------------------------

/** `COMBO_MAX_STEPS` is a hard product cap (donut legibility, cost) — not just a save-time error to fix later. */
export const canAddComboStep = (steps: readonly ComboStep[]): boolean =>
  steps.length < COMBO_MAX_STEPS;

export const addComboStep = (
  steps: readonly ComboStep[],
  step: ComboStep,
): ComboStep[] => [...steps, step];

export const removeComboStep = (
  steps: readonly ComboStep[],
  index: number,
): ComboStep[] => steps.filter((_step, currentIndex) => currentIndex !== index);

/** Sets the preset for the step at `index`. An out-of-range index is a no-op copy, like `removeComboStep`. */
export const setComboStepPreset = (
  steps: readonly ComboStep[],
  index: number,
  presetId: string,
): ComboStep[] =>
  steps.map((step, currentIndex) =>
    currentIndex === index ? { ...step, presetId } : step,
  );

/** Sets the frozen inline input for the step at `index`. An out-of-range index is a no-op copy, like `removeComboStep`. */
export const setComboStepInlineInput = (
  steps: readonly ComboStep[],
  index: number,
  inlineInput: string,
): ComboStep[] =>
  steps.map((step, currentIndex) =>
    currentIndex === index ? { ...step, inlineInput } : step,
  );

// --- requiresInput detection --------------------------------------------

export type ComboStepPresetLookup = ReadonlyMap<
  string,
  Pick<CorrectionPreset, "name" | "requiresInput">
>;

export const buildComboStepPresetLookup = (
  presets: readonly CorrectionPreset[],
): ComboStepPresetLookup =>
  new Map(
    presets.map((preset) => [
      preset.id,
      { name: preset.name, requiresInput: preset.requiresInput },
    ]),
  );

/**
 * A combo never opens the Ask input window, so a step whose preset has
 * `requiresInput` only works with a frozen `inlineInput` standing in for the
 * question. Mirrors the rule `comboValidation.ts` enforces at save time.
 */
export const comboStepNeedsInlineInput = (
  step: ComboStep,
  presetsById: ComboStepPresetLookup,
): boolean => presetsById.get(step.presetId)?.requiresInput === true;

// --- Error -> field mapping, with localized messages ---------------------

/**
 * `ComboValidationError.message` is baked English prose (`comboValidation.ts`
 * has zero i18n dependency by design — it stays a pure, locale-free module).
 * The editor re-derives a `Message` descriptor per error instead of rendering
 * that prose, so the combo editor stays translatable like every other
 * aggregation surface in the app (`msg()` / `tm()`, never raw strings).
 */
export const comboErrorMessage = (
  error: ComboValidationError,
  combo: ComboPreset,
  presetsById: ComboStepPresetLookup,
): Message => {
  switch (error.code) {
    case "step-count":
      return msg("settings.correction.combos.error.stepCount", {
        min: COMBO_MIN_STEPS,
        max: COMBO_MAX_STEPS,
        count: combo.steps.length,
      });
    case "name-empty":
      return msg("settings.correction.combos.error.nameEmpty");
    case "name-duplicate":
      return msg("settings.correction.combos.error.nameDuplicate", {
        name: combo.name.trim(),
      });
    case "unknown-preset":
      return msg("settings.correction.combos.error.unknownPreset");
    case "missing-inline-input": {
      const step = combo.steps.find((candidate) => candidate.id === error.stepId);
      const presetName = step ? presetsById.get(step.presetId)?.name ?? "" : "";
      return msg("settings.correction.combos.error.missingInlineInput", {
        presetName,
      });
    }
  }
};

export type ComboEditorFieldMessages = {
  nameErrors: Message[];
  stepCountErrors: Message[];
  stepErrorsById: Readonly<Record<string, Message[]>>;
};

/**
 * Groups every error `validateCombo` returned for ONE combo by the field it
 * belongs on, so the editor can show all of them at once instead of walking
 * the user through a fix-one-save-again loop.
 */
export const mapComboErrorsToFieldMessages = (
  errors: readonly ComboValidationError[],
  combo: ComboPreset,
  presetsById: ComboStepPresetLookup,
): ComboEditorFieldMessages => {
  const nameErrors: Message[] = [];
  const stepCountErrors: Message[] = [];
  const stepErrorsById: Record<string, Message[]> = {};

  for (const error of errors) {
    const message = comboErrorMessage(error, combo, presetsById);
    if (error.stepId) {
      stepErrorsById[error.stepId] = [...(stepErrorsById[error.stepId] ?? []), message];
    } else if (error.code === "step-count") {
      stepCountErrors.push(message);
    } else {
      nameErrors.push(message);
    }
  }

  return { nameErrors, stepCountErrors, stepErrorsById };
};

// --- Save gating across every combo -------------------------------------

export type ComboErrorsById = ReadonlyMap<string, readonly ComboValidationError[]>;

/**
 * Runs `validateCombo` for every combo in the profile (not just the one being
 * edited) and keeps every error it returns. Save must stay blocked as long as
 * ANY combo is invalid, and every error for every invalid combo must surface
 * at once — never one combo, or one error, per round-trip.
 */
export const collectComboErrors = (
  combos: readonly ComboPreset[],
  presets: readonly CorrectionPreset[],
): ComboErrorsById => {
  const errorsById = new Map<string, readonly ComboValidationError[]>();
  for (const combo of combos) {
    // `validateCombo`'s own signature takes mutable arrays even though it
    // never mutates them; copy rather than loosen this module's `readonly`
    // params just to satisfy that.
    const errors = validateCombo(combo, [...presets], [...combos]);
    if (errors.length > 0) {
      errorsById.set(combo.id, errors);
    }
  }
  return errorsById;
};

export const hasBlockingComboErrors = (errorsById: ComboErrorsById): boolean =>
  errorsById.size > 0;
