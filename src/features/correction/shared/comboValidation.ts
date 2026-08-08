/**
 * @file comboValidation.ts
 * @description Pure Combo validator. No Electron, no React — safe for Vitest
 * without mocks. Called at save time and at profile import.
 *
 * Hotkey collision is deliberately NOT checked here. Every accelerator in the
 * app — presets, combos, `promptGen`, `profileSwitch` and the reserved cancel
 * chord — shares one registration space, so the check has to see all of them at
 * once; `validateHotkeys` is that single gate. A second, combo-only copy of the
 * rule here could only ever disagree with it.
 *
 * Unlike `validateHotkeys`, which returns the FIRST conflict, this returns every
 * error: a combo editor shows the name and the whole step list at once, so
 * surfacing one problem per save would walk the user through them one round-trip
 * at a time.
 */

import type {
  ComboPreset,
  CorrectionPreset,
} from "~/features/providers/store/apiStore";

/**
 * Statically reserved for combo cancel. No preset, combo, or app keybinding may
 * hold it: a holder makes `globalShortcut.register` return false at run start,
 * and the combo is then silently uncancellable. Enforced by `validateHotkeys`,
 * which imports this constant.
 */
export const COMBO_CANCEL_ACCELERATOR = "Control+Escape";

/** One step is a preset; five is where cost and the overlay donut stay legible. */
export const COMBO_MIN_STEPS = 2;
export const COMBO_MAX_STEPS = 5;

export type ComboValidationCode =
  | "step-count"
  | "unknown-preset"
  | "missing-inline-input"
  | "name-empty"
  | "name-duplicate";

export type ComboValidationError = {
  code: ComboValidationCode;
  message: string;
  /** Set when the error belongs to one step rather than to the combo. */
  stepId?: string;
};

const collectStepErrors = (
  combo: ComboPreset,
  presets: CorrectionPreset[],
): ComboValidationError[] => {
  const presetById = new Map(presets.map((preset) => [preset.id, preset]));

  return combo.steps.flatMap((step): ComboValidationError[] => {
    const preset = presetById.get(step.presetId);

    if (!preset) {
      return [
        {
          code: "unknown-preset",
          message: `Step references a preset that no longer exists: "${step.presetId}".`,
          stepId: step.id,
        },
      ];
    }

    // A combo never opens the Ask input window, so the question has to be
    // frozen into the step or the run has nothing to ask.
    if (preset.requiresInput === true && !step.inlineInput?.trim()) {
      return [
        {
          code: "missing-inline-input",
          message: `"${preset.name}" needs its own input text inside a combo.`,
          stepId: step.id,
        },
      ];
    }

    return [];
  });
};

const collectNameErrors = (
  combo: ComboPreset,
  allCombos: ComboPreset[],
): ComboValidationError[] => {
  const name = combo.name.trim();
  if (!name) {
    return [{ code: "name-empty", message: "Give the combo a name." }];
  }

  // Trimmed-exact, matching how hotkeys are compared app-wide rather than
  // introducing a second, softer notion of "the same" in one place.
  const duplicate = allCombos.some(
    (other) => other.id !== combo.id && other.name.trim() === name,
  );
  return duplicate
    ? [
        {
          code: "name-duplicate",
          message: `Another combo is already called "${name}".`,
        },
      ]
    : [];
};

/**
 * @param combo - The combo being saved. May or may not appear in `allCombos`;
 *   it is matched out by id either way, so a combo never conflicts with itself.
 * @param presets - Presets of the profile the combo belongs to.
 * @param allCombos - Every combo in that profile. Needed for name uniqueness.
 */
export const validateCombo = (
  combo: ComboPreset,
  presets: CorrectionPreset[],
  allCombos: ComboPreset[],
): ComboValidationError[] => {
  const stepCountErrors: ComboValidationError[] =
    combo.steps.length < COMBO_MIN_STEPS || combo.steps.length > COMBO_MAX_STEPS
      ? [
          {
            code: "step-count",
            message: `A combo runs between ${COMBO_MIN_STEPS} and ${COMBO_MAX_STEPS} steps; this one has ${combo.steps.length}.`,
          },
        ]
      : [];

  return [
    ...collectNameErrors(combo, allCombos),
    ...stepCountErrors,
    ...collectStepErrors(combo, presets),
  ];
};
