/**
 * @file presetOptions.test.ts
 * @description Unit tests for the pure preset-option registry: what the
 * registry declares, what `sanitizePresetOptions` refuses, and the byte
 * identity `withPresetOptions` owes a preset that declares no options.
 * Pure — no Electron, no IPC, no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  CAVEMAN_MODE_OPTION_KEY,
  presetOptionDefinitions,
  resolvePresetOptionValue,
  sanitizePresetOptions,
  withPresetOptions,
} from "~/features/correction/shared/presetOptions";
import {
  DEFAULT_CAVEMAN_FULL_DIRECTIVE,
  DEFAULT_CAVEMAN_LITE_DIRECTIVE,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
  DEFAULT_CORRECTION_PRESET_ID,
} from "~/prompts/correction";

describe("presetOptionDefinitions — what the registry declares", () => {
  it("declares exactly one option for the caveman preset", () => {
    const definitions = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);

    expect(definitions).toHaveLength(1);
    expect(definitions[0].key).toBe(CAVEMAN_MODE_OPTION_KEY);
  });

  it("offers lite / full / ultra in that order, defaulting to full", () => {
    const [option] = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);

    expect(option.choices.map((choice) => choice.value)).toEqual([
      "lite",
      "full",
      "ultra",
    ]);
    expect(option.defaultValue).toBe("full");
  });

  it("the declared default is one of the declared choices", () => {
    for (const definitions of [
      presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID),
    ]) {
      for (const option of definitions) {
        expect(option.choices.map((choice) => choice.value)).toContain(
          option.defaultValue,
        );
      }
    }
  });

  it("wires each choice to card 01's standalone intensity directive", () => {
    const [option] = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);
    const fragmentByValue = Object.fromEntries(
      option.choices.map((choice) => [choice.value, choice.promptFragment]),
    );

    expect(fragmentByValue.lite).toBe(DEFAULT_CAVEMAN_LITE_DIRECTIVE);
    expect(fragmentByValue.full).toBe(DEFAULT_CAVEMAN_FULL_DIRECTIVE);
    expect(fragmentByValue.ultra).toBe(DEFAULT_CAVEMAN_ULTRA_DIRECTIVE);
  });

  it("carries a label key, a hint key, and one label key per choice", () => {
    const [option] = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);

    expect(option.labelKey).toBeTruthy();
    expect(option.hintKey).toBeTruthy();
    expect(option.labelKey).not.toBe(option.hintKey);

    const choiceLabelKeys = option.choices.map((choice) => choice.labelKey);
    expect(choiceLabelKeys.every((key) => key.length > 0)).toBe(true);
    expect(new Set(choiceLabelKeys).size).toBe(option.choices.length);
  });

  it("declares nothing for a preset that registered no options", () => {
    expect(presetOptionDefinitions(DEFAULT_CORRECTION_PRESET_ID)).toEqual([]);
    expect(presetOptionDefinitions("preset-that-never-existed")).toEqual([]);
  });

  it("declares nothing for an Object.prototype member name", () => {
    // A stored preset id is user data. A plain `registry[id]` lookup would
    // answer `toString`/`constructor`/`__proto__` with an inherited value.
    for (const inherited of ["__proto__", "constructor", "toString", "valueOf"]) {
      expect(presetOptionDefinitions(inherited)).toEqual([]);
    }
  });

  it("declares nothing for a non-string preset id", () => {
    for (const notAString of [undefined, null, 7, {}, [], true, Symbol("x")]) {
      expect(presetOptionDefinitions(notAString)).toEqual([]);
    }
  });
});

describe("sanitizePresetOptions — total over unknown", () => {
  it("keeps a recognized key with a recognized value", () => {
    expect(
      sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, {
        [CAVEMAN_MODE_OPTION_KEY]: "ultra",
      }),
    ).toEqual({ [CAVEMAN_MODE_OPTION_KEY]: "ultra" });
  });

  it("drops an unknown key", () => {
    expect(
      sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, {
        somethingElse: "ultra",
      }),
    ).toBeUndefined();
  });

  it("keeps the recognized key and drops the unknown one alongside it", () => {
    expect(
      sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, {
        somethingElse: "ultra",
        [CAVEMAN_MODE_OPTION_KEY]: "lite",
      }),
    ).toEqual({ [CAVEMAN_MODE_OPTION_KEY]: "lite" });
  });

  it("drops an unrecognized value for a recognized key", () => {
    for (const bogus of ["LITE", "lite ", "extreme", ""]) {
      expect(
        sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, {
          [CAVEMAN_MODE_OPTION_KEY]: bogus,
        }),
      ).toBeUndefined();
    }
  });

  it("drops a non-string value for a recognized key", () => {
    for (const notAString of [
      1,
      true,
      null,
      undefined,
      ["lite"],
      { value: "lite" },
      Symbol("lite"),
      () => "lite",
    ]) {
      expect(
        sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, {
          [CAVEMAN_MODE_OPTION_KEY]: notAString,
        }),
      ).toBeUndefined();
    }
  });

  it("drops everything for a preset id that registered no options", () => {
    expect(
      sanitizePresetOptions(DEFAULT_CORRECTION_PRESET_ID, {
        [CAVEMAN_MODE_OPTION_KEY]: "ultra",
      }),
    ).toBeUndefined();
    expect(
      sanitizePresetOptions("preset-that-never-existed", {
        [CAVEMAN_MODE_OPTION_KEY]: "ultra",
      }),
    ).toBeUndefined();
  });

  it("returns undefined rather than {} for anything that is not a plain object", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "cavemanMode=ultra",
      0,
      42,
      true,
      false,
      [],
      [{ cavemanMode: "ultra" }],
      new Date(),
      Symbol("raw"),
      () => ({ cavemanMode: "ultra" }),
    ]) {
      expect(sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, raw)).toBeUndefined();
    }
  });

  it("returns undefined for an empty object", () => {
    expect(sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, {})).toBeUndefined();
  });

  it("reads own data properties only — never an inherited or accessor value", () => {
    const inherited = Object.create({ [CAVEMAN_MODE_OPTION_KEY]: "ultra" });
    expect(sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, inherited)).toBeUndefined();

    const accessor = {};
    Object.defineProperty(accessor, CAVEMAN_MODE_OPTION_KEY, {
      enumerable: true,
      get: () => {
        throw new Error("a getter on stored config must never be invoked");
      },
    });
    expect(() =>
      sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, accessor),
    ).not.toThrow();
    expect(sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, accessor)).toBeUndefined();
  });

  it("survives a hand-edited __proto__ key without polluting Object.prototype", () => {
    const polluted = JSON.parse(
      `{"__proto__":{"polluted":"yes"},"${CAVEMAN_MODE_OPTION_KEY}":"lite"}`,
    ) as unknown;

    expect(sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, polluted)).toEqual({
      [CAVEMAN_MODE_OPTION_KEY]: "lite",
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("returns a fresh object rather than the caller's stored one", () => {
    const stored = { [CAVEMAN_MODE_OPTION_KEY]: "lite" };

    expect(sanitizePresetOptions(DEFAULT_CAVEMAN_PRESET_ID, stored)).not.toBe(stored);
  });
});

describe("resolvePresetOptionValue", () => {
  it("returns the stored value when it is a recognized choice", () => {
    expect(
      resolvePresetOptionValue(
        {
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
        },
        CAVEMAN_MODE_OPTION_KEY,
      ),
    ).toBe("ultra");
  });

  it("falls back to the declared default when the option is absent", () => {
    expect(
      resolvePresetOptionValue(
        { id: DEFAULT_CAVEMAN_PRESET_ID },
        CAVEMAN_MODE_OPTION_KEY,
      ),
    ).toBe("full");
  });

  it("falls back to the declared default when the stored value is unrecognized", () => {
    expect(
      resolvePresetOptionValue(
        {
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "extreme" },
        },
        CAVEMAN_MODE_OPTION_KEY,
      ),
    ).toBe("full");
  });

  it("returns undefined for an option the preset never declared", () => {
    expect(
      resolvePresetOptionValue(
        { id: DEFAULT_CAVEMAN_PRESET_ID },
        "notAnOption",
      ),
    ).toBeUndefined();
    expect(
      resolvePresetOptionValue(
        {
          id: DEFAULT_CORRECTION_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
        },
        CAVEMAN_MODE_OPTION_KEY,
      ),
    ).toBeUndefined();
  });
});

describe("withPresetOptions", () => {
  const basePrompt = "Fix the grammar.";

  // Deliberately ragged: leading and trailing whitespace and a blank line are
  // what a trim, a normalize or an unconditional separator would silently eat,
  // and a prompt with none of those cannot tell the identity apart from a
  // reassembled equal string.
  const raggedPrompt = "\n  Fix the grammar.\n\n  Keep the tone.  \n\n";

  it("returns the input string byte-identical for a preset with no options", () => {
    const preset = { id: DEFAULT_CORRECTION_PRESET_ID };

    // `toBe`, not `toEqual`: the whole point is that nothing was rebuilt.
    expect(withPresetOptions(basePrompt, preset)).toBe(basePrompt);
    expect(withPresetOptions(raggedPrompt, preset)).toBe(raggedPrompt);
    expect(withPresetOptions("", preset)).toBe("");
  });

  it("is still the identity when a preset with no options carries stray extraOptions", () => {
    const preset = {
      id: DEFAULT_CORRECTION_PRESET_ID,
      extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
    };

    expect(withPresetOptions(basePrompt, preset)).toBe(basePrompt);
    expect(withPresetOptions(raggedPrompt, preset)).toBe(raggedPrompt);
  });

  it("leaves the declaring preset's own prompt untouched ahead of the fragment", () => {
    expect(
      withPresetOptions(raggedPrompt, {
        id: DEFAULT_CAVEMAN_PRESET_ID,
        extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "lite" },
      }),
    ).toBe(`${raggedPrompt}\n\n${DEFAULT_CAVEMAN_LITE_DIRECTIVE}`);
  });

  it("appends the selected fragment after the system prompt", () => {
    const composed = withPresetOptions(basePrompt, {
      id: DEFAULT_CAVEMAN_PRESET_ID,
      extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
    });

    expect(composed).toBe(`${basePrompt}\n\n${DEFAULT_CAVEMAN_ULTRA_DIRECTIVE}`);
  });

  it("appends the default fragment when the preset stores no selection", () => {
    expect(withPresetOptions(basePrompt, { id: DEFAULT_CAVEMAN_PRESET_ID })).toBe(
      `${basePrompt}\n\n${DEFAULT_CAVEMAN_FULL_DIRECTIVE}`,
    );
  });

  it("appends the default fragment when the stored selection is unrecognized", () => {
    expect(
      withPresetOptions(basePrompt, {
        id: DEFAULT_CAVEMAN_PRESET_ID,
        extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "extreme" },
      }),
    ).toBe(`${basePrompt}\n\n${DEFAULT_CAVEMAN_FULL_DIRECTIVE}`);
  });
});
