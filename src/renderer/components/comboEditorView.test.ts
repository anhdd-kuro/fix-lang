/**
 * @file comboEditorView.test.ts
 * @description Full cover of the pure combo-editor derivations. No Electron,
 * no React, no jsdom rendering — every decision the JSX shell defers to
 * `comboEditorView.ts` is asserted directly here.
 */
import { describe, expect, it } from "vitest";
import {
  COMBO_MAX_STEPS,
  COMBO_MIN_STEPS,
  type ComboValidationError,
} from "~/features/correction/shared/comboValidation";
import {
  addComboStep,
  buildComboStepPresetLookup,
  canAddComboStep,
  canMoveComboStep,
  collectComboErrors,
  comboErrorMessage,
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
} from "./comboEditorView";
import type {
  ComboPreset,
  ComboStep,
  CorrectionPreset,
} from "~/features/providers/store/apiStore";

const preset = (
  id: string,
  overrides: Partial<CorrectionPreset> = {},
): CorrectionPreset => ({
  id,
  name: `Preset ${id}`,
  hotkey: "",
  systemPrompt: "Do the thing.",
  model: "",
  isBuiltIn: false,
  ...overrides,
});

const PRESETS: CorrectionPreset[] = [
  preset("correction", { name: "Correction" }),
  preset("translate", { name: "Translate" }),
  preset("ask", { name: "Ask AI", requiresInput: true }),
];

const step = (presetId: string, overrides: Partial<ComboStep> = {}): ComboStep => ({
  id: `step-${presetId}`,
  presetId,
  ...overrides,
});

const combo = (overrides: Partial<ComboPreset> = {}): ComboPreset => ({
  id: "combo-1",
  name: "Polish and Translate",
  hotkey: "",
  steps: [step("correction"), step("translate")],
  schemaVersion: 1,
  ...overrides,
});

describe("createComboStep / createInitialComboSteps", () => {
  it("builds a step with the supplied id and presetId", () => {
    expect(createComboStep("s1", "correction")).toEqual({
      id: "s1",
      presetId: "correction",
    });
  });

  it(`seeds exactly ${COMBO_MIN_STEPS} steps from the first available presets`, () => {
    let counter = 0;
    const steps = createInitialComboSteps(["correction", "translate", "ask"], () => {
      counter += 1;
      return `gen-${counter}`;
    });

    expect(steps).toEqual([
      { id: "gen-1", presetId: "correction" },
      { id: "gen-2", presetId: "translate" },
    ]);
  });

  it("repeats the only preset when fewer than the minimum exist", () => {
    let counter = 0;
    const steps = createInitialComboSteps(["correction"], () => {
      counter += 1;
      return `gen-${counter}`;
    });

    expect(steps).toEqual([
      { id: "gen-1", presetId: "correction" },
      { id: "gen-2", presetId: "correction" },
    ]);
  });

  it("returns no steps when there are no presets to seed from", () => {
    expect(createInitialComboSteps([], () => "gen")).toEqual([]);
  });
});

describe("nextComboDraftName / createComboDraft", () => {
  it("names the first combo 'Combo 1'", () => {
    expect(nextComboDraftName([])).toBe("Combo 1");
  });

  it("skips a name already taken by an existing combo", () => {
    expect(
      nextComboDraftName([{ name: "Combo 1" }, { name: "Combo 2" }]),
    ).toBe("Combo 3");
  });

  it("builds a draft with an empty hotkey and schemaVersion 1", () => {
    const draft = createComboDraft("combo-9", "Combo 9", [step("correction")]);
    expect(draft).toEqual({
      id: "combo-9",
      name: "Combo 9",
      hotkey: "",
      steps: [step("correction")],
      schemaVersion: 1,
    });
  });

  it("does not alias the steps array passed in", () => {
    const steps = [step("correction")];
    const draft = createComboDraft("combo-9", "Combo 9", steps);
    expect(draft.steps).not.toBe(steps);
    expect(draft.steps).toEqual(steps);
  });
});

describe("nextComboDraftName — collision handling", () => {
  it("counts forward from the current combo count, skipping a name already renamed into its path", () => {
    // One existing combo means the ordinal search starts at "Combo 2" — which
    // this profile's only combo already renamed itself to — so it must skip
    // ahead to "Combo 3" rather than colliding.
    expect(nextComboDraftName([{ name: "Combo 2" }])).toBe("Combo 3");
  });

  it("compares names trimmed", () => {
    expect(nextComboDraftName([{ name: "  Combo 1  " }])).toBe("Combo 2");
  });
});

describe("canMoveComboStep / moveComboStep", () => {
  const steps = [step("a"), step("b"), step("c")];

  it("cannot move the first step up", () => {
    expect(canMoveComboStep(steps, 0, "up")).toBe(false);
  });

  it("cannot move the last step down", () => {
    expect(canMoveComboStep(steps, steps.length - 1, "down")).toBe(false);
  });

  it("can move a middle step either way", () => {
    expect(canMoveComboStep(steps, 1, "up")).toBe(true);
    expect(canMoveComboStep(steps, 1, "down")).toBe(true);
  });

  it("swaps with the previous step on 'up'", () => {
    expect(moveComboStep(steps, 1, "up").map((s) => s.presetId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("swaps with the next step on 'down'", () => {
    expect(moveComboStep(steps, 1, "down").map((s) => s.presetId)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("is a no-op (but still a new array) when the move is illegal", () => {
    const result = moveComboStep(steps, 0, "up");
    expect(result).toEqual(steps);
    expect(result).not.toBe(steps);
  });

  it("never mutates the input array", () => {
    const original = [step("a"), step("b")];
    const snapshot = [...original];
    moveComboStep(original, 0, "down");
    expect(original).toEqual(snapshot);
  });

  it("cannot move an out-of-range index in either direction", () => {
    // canMoveComboStep must bound BOTH ends regardless of direction: a stray
    // out-of-range index (should never happen — the index always comes from
    // steps.map — but must fail closed if it ever does) must not read as
    // movable just because it clears the one-sided check for its direction.
    expect(canMoveComboStep(steps, 7, "up")).toBe(false);
    expect(canMoveComboStep(steps, -1, "down")).toBe(false);
  });

  it("moving an out-of-range index is a no-op copy, not a sparse array", () => {
    const result = moveComboStep(steps, 7, "up");
    expect(result).toEqual(steps);
    expect(result).not.toBe(steps);
    expect(result).toHaveLength(steps.length);
  });
});

describe("reorderComboStep", () => {
  const steps = [step("a"), step("b"), step("c"), step("d")];
  const ids = (result: readonly ComboStep[]) =>
    result.map((entry) => entry.presetId);

  it("moves a step to the drop index rather than swapping neighbours", () => {
    // A drop onto a distant row means "put it here", so the steps between the
    // grab and the drop close up — a neighbour swap would displace only one.
    expect(ids(reorderComboStep(steps, 0, 2))).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a step backwards to the drop index", () => {
    expect(ids(reorderComboStep(steps, 3, 1))).toEqual(["a", "d", "b", "c"]);
  });

  it("moves a step to the end", () => {
    expect(ids(reorderComboStep(steps, 1, 3))).toEqual(["a", "c", "d", "b"]);
  });

  it("is a no-op copy when the step is dropped on itself", () => {
    const result = reorderComboStep(steps, 2, 2);
    expect(result).toEqual(steps);
    expect(result).not.toBe(steps);
  });

  it("is a no-op copy for a negative index at either end", () => {
    // `not.toBe` is the assertion that matters: a refusal handing back the
    // caller's own array would satisfy `toEqual` while letting the caller's
    // later mutation reach through into the stored steps.
    const negativeFrom = reorderComboStep(steps, -1, 2);
    expect(negativeFrom).toEqual(steps);
    expect(negativeFrom).not.toBe(steps);
    const negativeTo = reorderComboStep(steps, 1, -1);
    expect(negativeTo).toEqual(steps);
    expect(negativeTo).not.toBe(steps);
  });

  it("is a no-op copy for an out-of-range index at either end", () => {
    // A drag can outlive the row it started on (a step removed mid-drag), so
    // both ends must fail closed instead of producing a sparse array.
    const fromOutOfRange = reorderComboStep(steps, steps.length, 0);
    expect(fromOutOfRange).toEqual(steps);
    expect(fromOutOfRange).toHaveLength(steps.length);
    expect(fromOutOfRange).not.toBe(steps);
    const toOutOfRange = reorderComboStep(steps, 0, steps.length);
    expect(toOutOfRange).toEqual(steps);
    expect(toOutOfRange).not.toBe(steps);
  });

  it("never mutates the input array or its steps", () => {
    const original = [step("a"), step("b"), step("c")];
    const snapshot = original.map((entry) => ({ ...entry }));
    const result = reorderComboStep(original, 0, 2);
    expect(original).toEqual(snapshot);
    expect(result).not.toBe(original);
  });

  it("keeps the same step objects, so per-step state survives a reorder", () => {
    const result = reorderComboStep(steps, 0, 2);
    expect(result[2]).toBe(steps[0]);
  });

  it("is a no-op copy on an empty list", () => {
    expect(reorderComboStep([], 0, 0)).toEqual([]);
  });
});

describe("canAddComboStep / addComboStep / removeComboStep", () => {
  it(`allows adding below ${COMBO_MAX_STEPS} steps`, () => {
    const steps = Array.from({ length: COMBO_MAX_STEPS - 1 }, (_v, i) => step(`p${String(i)}`));
    expect(canAddComboStep(steps)).toBe(true);
  });

  it(`blocks adding at ${COMBO_MAX_STEPS} steps — a hard product cap, not just a save-time error`, () => {
    const steps = Array.from({ length: COMBO_MAX_STEPS }, (_v, i) => step(`p${String(i)}`));
    expect(canAddComboStep(steps)).toBe(false);
  });

  it("appends without mutating the input", () => {
    const steps = [step("a")];
    const next = addComboStep(steps, step("b"));
    expect(next).toEqual([step("a"), step("b")]);
    expect(steps).toEqual([step("a")]);
  });

  it("removes by index without mutating the input", () => {
    const steps = [step("a"), step("b"), step("c")];
    const next = removeComboStep(steps, 1);
    expect(next.map((s) => s.presetId)).toEqual(["a", "c"]);
    expect(steps).toHaveLength(3);
  });

  it("removing an out-of-range index is a no-op copy", () => {
    const steps = [step("a")];
    expect(removeComboStep(steps, 5)).toEqual(steps);
  });
});

describe("setComboStepPreset", () => {
  it("sets the presetId on the targeted step only", () => {
    const steps = [step("a"), step("b"), step("c")];
    const next = setComboStepPreset(steps, 1, "translate");
    expect(next.map((s) => s.presetId)).toEqual(["a", "translate", "c"]);
  });

  it("leaves every other step's identity untouched", () => {
    const steps = [step("a"), step("b")];
    const next = setComboStepPreset(steps, 1, "translate");
    expect(next[0]).toBe(steps[0]);
    expect(next[1]).not.toBe(steps[1]);
  });

  it("never mutates the input array or its steps", () => {
    const original = [step("a"), step("b")];
    const snapshot = [...original];
    setComboStepPreset(original, 0, "translate");
    expect(original).toEqual(snapshot);
  });

  it("an out-of-range index is a no-op copy, consistent with removeComboStep", () => {
    const steps = [step("a")];
    const next = setComboStepPreset(steps, 5, "translate");
    expect(next).toEqual(steps);
    expect(next).not.toBe(steps);
  });
});

describe("setComboStepInlineInput", () => {
  it("sets the inlineInput on the targeted step only", () => {
    const steps = [step("ask", { id: "s-ask" }), step("correction")];
    const next = setComboStepInlineInput(steps, 0, "What's the weather?");
    expect(next[0]).toEqual({ ...steps[0], inlineInput: "What's the weather?" });
    expect(next[1]).toBe(steps[1]);
  });

  it("does not touch presetId or other fields on the targeted step", () => {
    const steps = [step("ask", { id: "s-ask" })];
    const next = setComboStepInlineInput(steps, 0, "context");
    expect(next[0].presetId).toBe("ask");
    expect(next[0].id).toBe("s-ask");
  });

  it("never mutates the input array or its steps", () => {
    const original = [step("ask", { id: "s-ask" })];
    const snapshot = [...original];
    setComboStepInlineInput(original, 0, "context");
    expect(original).toEqual(snapshot);
  });

  it("an out-of-range index is a no-op copy, consistent with removeComboStep", () => {
    const steps = [step("a")];
    const next = setComboStepInlineInput(steps, 5, "context");
    expect(next).toEqual(steps);
    expect(next).not.toBe(steps);
  });
});

describe("buildComboStepPresetLookup / comboStepNeedsInlineInput", () => {
  const lookup = buildComboStepPresetLookup(PRESETS);

  it("reports false for an ordinary preset", () => {
    expect(comboStepNeedsInlineInput(step("correction"), lookup)).toBe(false);
  });

  it("reports true for a requiresInput preset (Ask AI)", () => {
    expect(comboStepNeedsInlineInput(step("ask"), lookup)).toBe(true);
  });

  it("reports false for a step whose preset is unknown (deleted)", () => {
    expect(comboStepNeedsInlineInput(step("deleted"), lookup)).toBe(false);
  });
});

describe("comboErrorMessage", () => {
  const lookup = buildComboStepPresetLookup(PRESETS);

  it("resolves step-count with min/max/count params", () => {
    const oneStepCombo = combo({ steps: [step("correction")] });
    const error: ComboValidationError = { code: "step-count", message: "" };
    expect(comboErrorMessage(error, oneStepCombo, lookup)).toEqual({
      key: "settings.correction.combos.error.stepCount",
      params: { min: COMBO_MIN_STEPS, max: COMBO_MAX_STEPS, count: 1 },
    });
  });

  it("resolves name-empty with no params", () => {
    const error: ComboValidationError = { code: "name-empty", message: "" };
    expect(comboErrorMessage(error, combo(), lookup)).toEqual({
      key: "settings.correction.combos.error.nameEmpty",
    });
  });

  it("resolves name-duplicate with the trimmed name", () => {
    const error: ComboValidationError = { code: "name-duplicate", message: "" };
    expect(
      comboErrorMessage(error, combo({ name: "  Dup  " }), lookup),
    ).toEqual({
      key: "settings.correction.combos.error.nameDuplicate",
      params: { name: "Dup" },
    });
  });

  it("resolves unknown-preset without needing the dead presetId", () => {
    const withDeadStep = combo({ steps: [step("gone", { id: "s-gone" })] });
    const error: ComboValidationError = {
      code: "unknown-preset",
      message: "",
      stepId: "s-gone",
    };
    expect(comboErrorMessage(error, withDeadStep, lookup)).toEqual({
      key: "settings.correction.combos.error.unknownPreset",
    });
  });

  it("resolves missing-inline-input with the preset's display name", () => {
    const withAskStep = combo({ steps: [step("ask", { id: "s-ask" }), step("correction")] });
    const error: ComboValidationError = {
      code: "missing-inline-input",
      message: "",
      stepId: "s-ask",
    };
    expect(comboErrorMessage(error, withAskStep, lookup)).toEqual({
      key: "settings.correction.combos.error.missingInlineInput",
      params: { presetName: "Ask AI" },
    });
  });
});

describe("mapComboErrorsToFieldMessages", () => {
  const lookup = buildComboStepPresetLookup(PRESETS);

  it("routes name and step-count errors to their own buckets, and step errors by stepId", () => {
    const brokenCombo = combo({
      name: "",
      steps: [step("gone", { id: "s-gone" })],
    });
    const errors: ComboValidationError[] = [
      { code: "name-empty", message: "" },
      { code: "step-count", message: "" },
      { code: "unknown-preset", message: "", stepId: "s-gone" },
    ];

    const fields = mapComboErrorsToFieldMessages(errors, brokenCombo, lookup);

    expect(fields.nameErrors).toEqual([
      { key: "settings.correction.combos.error.nameEmpty" },
    ]);
    expect(fields.stepCountErrors).toEqual([
      {
        key: "settings.correction.combos.error.stepCount",
        params: { min: COMBO_MIN_STEPS, max: COMBO_MAX_STEPS, count: 1 },
      },
    ]);
    expect(fields.stepErrorsById).toEqual({
      "s-gone": [{ key: "settings.correction.combos.error.unknownPreset" }],
    });
  });

  it("collects multiple errors on the SAME step rather than dropping earlier ones", () => {
    // Not reachable through validateCombo today (a step can only be
    // unknown-preset XOR missing-inline-input), but the grouping itself must
    // not silently overwrite — this pins that it appends.
    const oneStep = combo({ steps: [step("ask", { id: "s-ask" })] });
    const errors: ComboValidationError[] = [
      { code: "missing-inline-input", message: "", stepId: "s-ask" },
      { code: "unknown-preset", message: "", stepId: "s-ask" },
    ];

    const fields = mapComboErrorsToFieldMessages(errors, oneStep, lookup);

    expect(fields.stepErrorsById["s-ask"]).toHaveLength(2);
  });

  it("returns empty buckets for a valid combo", () => {
    const fields = mapComboErrorsToFieldMessages([], combo(), lookup);
    expect(fields).toEqual({
      nameErrors: [],
      stepCountErrors: [],
      stepErrorsById: {},
    });
  });
});

describe("collectComboErrors / hasBlockingComboErrors", () => {
  it("is empty, and does not block, when every combo is valid", () => {
    const errors = collectComboErrors([combo()], PRESETS);
    expect(errors.size).toBe(0);
    expect(hasBlockingComboErrors(errors)).toBe(false);
  });

  it("blocks when even one combo among several is invalid", () => {
    const valid = combo();
    const invalid = combo({ id: "combo-2", name: "", steps: [step("correction")] });

    const errors = collectComboErrors([valid, invalid], PRESETS);

    expect(hasBlockingComboErrors(errors)).toBe(true);
    expect(errors.has(valid.id)).toBe(false);
  });

  it("keeps EVERY error for an invalid combo, not just the first", () => {
    const invalid = combo({ name: "", steps: [step("correction")] });
    const errors = collectComboErrors([invalid], PRESETS);

    expect(errors.get(invalid.id)?.map((error) => error.code).sort()).toEqual(
      ["name-empty", "step-count"].sort(),
    );
  });

  it("reports errors for EVERY invalid combo, not just one — 'shows every error at once'", () => {
    const invalidA = combo({ id: "combo-a", name: "", steps: [step("correction")] });
    const invalidB = combo({
      id: "combo-b",
      name: "B",
      steps: [step("gone-x"), step("gone-y")],
    });

    const errors = collectComboErrors([invalidA, invalidB], PRESETS);

    expect(errors.size).toBe(2);
    expect(errors.get("combo-a")?.map((e) => e.code)).toContain("name-empty");
    expect(errors.get("combo-b")?.map((e) => e.code)).toEqual([
      "unknown-preset",
      "unknown-preset",
    ]);
  });

  it("a combo not yet in the saved list (a fresh draft) still validates against its siblings", () => {
    const saved = combo({ id: "combo-1", name: "Taken" });
    const draft = combo({ id: "combo-2", name: "Taken" });

    const errors = collectComboErrors([saved, draft], PRESETS);

    expect(errors.get("combo-2")?.map((e) => e.code)).toEqual(["name-duplicate"]);
  });
});
