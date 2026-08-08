/**
 * @file comboValidation.test.ts
 * @description Rule-by-rule cover of the pure Combo validator.
 * No Electron, no IPC, no mocks — the module under test imports only types.
 */
import { describe, expect, it } from "vitest";
import {
  COMBO_CANCEL_ACCELERATOR,
  COMBO_MAX_STEPS,
  COMBO_MIN_STEPS,
  validateCombo,
  type ComboValidationCode,
} from "~/features/correction/shared/comboValidation";
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
  preset("correction", { name: "Correction", hotkey: "Control+Shift+F" }),
  preset("translate", { name: "Translate", hotkey: "Control+Shift+T" }),
  preset("summarize", { name: "Summarize" }),
  preset("business", { name: "Business Writing" }),
  preset("structured", { name: "Structured Text" }),
  preset("ask", { name: "Ask AI", requiresInput: true }),
];

const step = (
  presetId: string,
  overrides: Partial<ComboStep> = {},
): ComboStep => ({
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

const codesOf = (
  errors: { code: ComboValidationCode }[],
): ComboValidationCode[] => errors.map((error) => error.code);

describe("validateCombo — a well-formed combo", () => {
  it("returns no errors", () => {
    expect(validateCombo(combo(), PRESETS, [combo()])).toEqual([]);
  });

  it("accepts a combo absent from allCombos (a draft not yet saved)", () => {
    expect(validateCombo(combo(), PRESETS, [])).toEqual([]);
  });
});

describe("validateCombo — rule 1: step count", () => {
  const stepsOfLength = (length: number): ComboStep[] =>
    Array.from({ length }, (_, index) => step("correction", { id: `s${index}` }));

  it(`accepts exactly ${COMBO_MIN_STEPS} steps`, () => {
    const result = validateCombo(
      combo({ steps: stepsOfLength(COMBO_MIN_STEPS) }),
      PRESETS,
      [],
    );

    expect(result).toEqual([]);
  });

  it(`accepts exactly ${COMBO_MAX_STEPS} steps`, () => {
    const result = validateCombo(
      combo({ steps: stepsOfLength(COMBO_MAX_STEPS) }),
      PRESETS,
      [],
    );

    expect(result).toEqual([]);
  });

  it("rejects a single step — that is just a preset", () => {
    const result = validateCombo(combo({ steps: stepsOfLength(1) }), PRESETS, []);

    expect(codesOf(result)).toEqual(["step-count"]);
  });

  it("rejects an empty step list", () => {
    const result = validateCombo(combo({ steps: [] }), PRESETS, []);

    expect(codesOf(result)).toEqual(["step-count"]);
  });

  it(`rejects ${COMBO_MAX_STEPS + 1} steps`, () => {
    const result = validateCombo(
      combo({ steps: stepsOfLength(COMBO_MAX_STEPS + 1) }),
      PRESETS,
      [],
    );

    expect(codesOf(result)).toEqual(["step-count"]);
  });
});

describe("validateCombo — rule 2: every presetId resolves", () => {
  it("flags a step whose preset is gone, naming the step", () => {
    const result = validateCombo(
      combo({ steps: [step("correction"), step("deleted-preset")] }),
      PRESETS,
      [],
    );

    expect(codesOf(result)).toEqual(["unknown-preset"]);
    expect(result[0].stepId).toBe("step-deleted-preset");
  });

  it("reports EVERY broken step, not just the first", () => {
    const result = validateCombo(
      combo({ steps: [step("gone-a"), step("gone-b")] }),
      PRESETS,
      [],
    );

    expect(codesOf(result)).toEqual(["unknown-preset", "unknown-preset"]);
    expect(result.map((error) => error.stepId)).toEqual([
      "step-gone-a",
      "step-gone-b",
    ]);
  });
});

describe("validateCombo — rule 3: requiresInput steps carry inlineInput", () => {
  it("accepts a requiresInput step with inline input", () => {
    const result = validateCombo(
      combo({
        steps: [
          step("ask", { inlineInput: "What is the risk here?" }),
          step("correction"),
        ],
      }),
      PRESETS,
      [],
    );

    expect(result).toEqual([]);
  });

  it("rejects a requiresInput step with no inlineInput", () => {
    const result = validateCombo(
      combo({ steps: [step("ask"), step("correction")] }),
      PRESETS,
      [],
    );

    expect(codesOf(result)).toEqual(["missing-inline-input"]);
    expect(result[0].stepId).toBe("step-ask");
  });

  it("rejects whitespace-only inlineInput", () => {
    const result = validateCombo(
      combo({
        steps: [step("ask", { inlineInput: "  \n\t " }), step("correction")],
      }),
      PRESETS,
      [],
    );

    expect(codesOf(result)).toEqual(["missing-inline-input"]);
  });

  it("does not demand inlineInput from an ordinary preset", () => {
    const result = validateCombo(
      combo({ steps: [step("correction"), step("summarize")] }),
      PRESETS,
      [],
    );

    expect(result).toEqual([]);
  });
});

describe("validateCombo — rule 4: name", () => {
  it("rejects an empty name", () => {
    const result = validateCombo(combo({ name: "" }), PRESETS, []);

    expect(codesOf(result)).toEqual(["name-empty"]);
  });

  it("rejects a whitespace-only name", () => {
    const result = validateCombo(combo({ name: "   " }), PRESETS, []);

    expect(codesOf(result)).toEqual(["name-empty"]);
  });

  it("rejects a name another combo already uses", () => {
    const other = combo({ id: "combo-2", name: "Polish and Translate" });
    const result = validateCombo(combo(), PRESETS, [other]);

    expect(codesOf(result)).toEqual(["name-duplicate"]);
  });

  it("does not treat its own stored row as a duplicate", () => {
    const saved = combo();
    expect(validateCombo(saved, PRESETS, [saved])).toEqual([]);
  });

  it("compares names trimmed", () => {
    const other = combo({ id: "combo-2", name: "  Polish and Translate  " });
    const result = validateCombo(combo(), PRESETS, [other]);

    expect(codesOf(result)).toEqual(["name-duplicate"]);
  });
});

/**
 * Hotkey collision spans presets, combos, `promptGen`, `profileSwitch` and the
 * reserved cancel chord, which only `validateHotkeys` sees all of. A rule here
 * would be a second, narrower copy that could only disagree with it.
 */
describe("validateCombo — hotkeys are not this module's business", () => {
  it.each([
    ["a free accelerator", "Control+Shift+K"],
    ["a hotkey a preset already holds", "Control+Shift+T"],
    ["the combo-cancel chord", COMBO_CANCEL_ACCELERATOR],
    ["a blank hotkey", ""],
  ])("accepts %s", (_label, hotkey) => {
    expect(validateCombo(combo({ hotkey }), PRESETS, [])).toEqual([]);
  });

  it("accepts a hotkey another combo already holds", () => {
    const other = combo({
      id: "combo-2",
      name: "Other combo",
      hotkey: "Control+Shift+K",
    });

    expect(
      validateCombo(combo({ hotkey: "Control+Shift+K" }), PRESETS, [other]),
    ).toEqual([]);
  });
});

/**
 * The combo editor shows the name and every step at once. Returning one error
 * per save would walk the user through them a round-trip at a time.
 */
describe("validateCombo — reports every rule at once", () => {
  it("collects name, step-count and step errors together", () => {
    const result = validateCombo(
      combo({ name: "", steps: [step("ask")] }),
      PRESETS,
      [],
    );

    expect(codesOf(result).sort()).toEqual(
      ["missing-inline-input", "name-empty", "step-count"].sort(),
    );
  });
});
