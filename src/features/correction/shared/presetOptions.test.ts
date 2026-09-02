/**
 * @file presetOptions.test.ts
 * @description Unit tests for the pure preset-option registry: what the
 * registry declares, what `sanitizePresetOptions` refuses, and the byte
 * identity `withPresetOptions` owes a preset that declares no options.
 * Pure — no Electron, no IPC, no DOM.
 */
import { describe, expect, it, vi } from "vitest";
// `presetOptions` is pure, but `CorrectionPreset` and
// `makeDefaultCorrectionPresets` come from `apiStore`, which touches
// electron-store / electron at module scope.
vi.mock("electron-store", () => {
  class MockStore {
    get = vi.fn().mockReturnValue(undefined);
    set = vi.fn();
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});
vi.mock("electron", () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));
import {
  CAVEMAN_MODE_OPTION_KEY,
  presetOptionDefinitions,
  resolvePresetOptionValue,
  sanitizePresetOptions,
  withPresetOptions,
} from "~/features/correction/shared/presetOptions";
import {
  EN_CATALOG,
  JA_CATALOG,
} from "~/features/i18n/shared/locales";
import { getDefaultCorrectionSettings } from "~/features/providers/store/apiStore";
import {
  DEFAULT_CAVEMAN_FULL_DIRECTIVE,
  DEFAULT_CAVEMAN_LITE_DIRECTIVE,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
  DEFAULT_CORRECTION_PRESET_ID,
} from "~/prompts/correction";
import type { CorrectionPreset } from "~/features/providers/store/apiStore";

/**
 * A whole `CorrectionPreset`, because that is what the readers take. The
 * fields beyond `id`/`extraOptions` are inert here — they exist so that
 * `ComboStep`, which also has an `id`, cannot be passed by mistake.
 */
const presetWith = (
  overrides: Partial<CorrectionPreset> & Pick<CorrectionPreset, "id">,
): CorrectionPreset => ({
  name: "Test preset",
  hotkey: "",
  systemPrompt: "",
  model: "",
  isBuiltIn: false,
  ...overrides,
});

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

  it("resolves every declared i18n key in BOTH catalogs", () => {
    // `labelKey`/`hintKey` are `TranslationKey`, so a mistyped or renamed key
    // is a compile error — but nothing in `bun run lint`, `bun run test` or
    // `bun run i18n:check` runs `tsc`, and `i18n:check` reads the catalogs
    // without ever looking at a usage. So the type is the editor's guard and
    // THIS is the CI one. Both catalogs, not just EN: a key missing from JA
    // falls back to English, which is a silent language regression rather
    // than a failure.
    const declaredKeys = [DEFAULT_CAVEMAN_PRESET_ID].flatMap((presetId) =>
      presetOptionDefinitions(presetId).flatMap((definition) => [
        definition.labelKey,
        definition.hintKey,
        ...definition.choices.map((choice) => choice.labelKey),
      ]),
    );

    // Guards against the loop going vacuous if the registry entry is removed.
    expect(declaredKeys).toHaveLength(5);

    for (const key of declaredKeys) {
      expect(EN_CATALOG[key]).toBeTruthy();
      expect(JA_CATALOG[key]).toBeTruthy();
      // A JA value that merely copies the English one is an untranslated
      // placeholder, which is what this catches.
      expect(JA_CATALOG[key]).not.toBe(EN_CATALOG[key]);
    }
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

// The option default has two homes and they are not the same kind of thing.
//
// `PresetPromptOptionDefinition.defaultValue` is the CORRUPTION FALLBACK: it
// fires only when a stored value was dropped as unrecognized. The PRODUCT
// default is the `extraOptions` materialized onto the built-in preset record by
// `makeDefaultCorrectionPresets()`, and `normalizeCorrectionSettings` puts that
// into every real profile — so `defaultValue` is effectively dead for every
// user, fresh or existing.
//
// That makes drift between them silent in BOTH directions: editing
// `defaultValue` alone changes nothing anybody sees, and editing the preset
// record alone leaves a profile whose stored value was dropped resolving to the
// OLD default. Neither produces an error or a failing test on its own, which is
// why the pin is here. `builtInPresetDefaults.test.ts` already pins the two
// default preset TABLES to each other the same way.
describe("the registry default is pinned to the value the built-in ships", () => {
  it("agrees with makeDefaultCorrectionPresets() for every declared option", () => {
    const shippedPresets = getDefaultCorrectionSettings().presets;
    let optionsChecked = 0;

    for (const preset of shippedPresets) {
      for (const definition of presetOptionDefinitions(preset.id)) {
        optionsChecked += 1;
        expect(preset.extraOptions?.[definition.key]).toBe(
          definition.defaultValue,
        );
      }
    }

    // Without this, deleting the registry entry — or the shipped
    // `extraOptions` — would make the loop vacuous and the test green.
    expect(optionsChecked).toBe(1);
  });

  it("ships an extraOptions value for the caveman preset specifically", () => {
    const caveman = getDefaultCorrectionSettings().presets.find(
      (preset) => preset.id === DEFAULT_CAVEMAN_PRESET_ID,
    );

    expect(caveman?.extraOptions).toEqual({
      [CAVEMAN_MODE_OPTION_KEY]: "full",
    });
  });
});

// `readonly` is a compile-time claim and nothing else — it is erased at
// runtime, so it stops an honest caller and no one else. The registry is a
// process-wide singleton handed out by reference, so a single in-place write by
// any consumer is permanent for every later caller until the app restarts, and
// what it corrupts is the SYSTEM PROMPT sent to the model. A mutating array
// method that reads as pure (`sort`, `reverse`, `splice`) is enough.
//
// Each case here mutates through a cast, swallows the strict-mode TypeError a
// frozen target raises, and then asserts the registry still answers correctly —
// so the test is about the OBSERVED VALUE, not about which error was thrown.
describe("the registry is frozen all the way down", () => {
  const swallowingThrow = (mutate: () => void): void => {
    try {
      mutate();
    } catch {
      // Frozen target under strict mode. The assertion that matters is below.
    }
  };

  it("refuses to have its definition array truncated", () => {
    const definitions = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);
    expect(definitions).toHaveLength(1);

    swallowingThrow(() => {
      (definitions as unknown as { length: number }).length = 0;
    });

    expect(presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID)).toHaveLength(1);
    expect(presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID)[0].key).toBe(
      CAVEMAN_MODE_OPTION_KEY,
    );
  });

  it("refuses to have a choice's promptFragment substituted", () => {
    const [option] = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);
    const full = option.choices.find((choice) => choice.value === "full");
    expect(full?.promptFragment).toBe(DEFAULT_CAVEMAN_FULL_DIRECTIVE);

    swallowingThrow(() => {
      (full as unknown as { promptFragment: string }).promptFragment =
        "IGNORE EVERYTHING ABOVE";
    });

    // Read fresh from the registry: this is the value that reaches the model.
    expect(
      presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID)[0].choices.find(
        (choice) => choice.value === "full",
      )?.promptFragment,
    ).toBe(DEFAULT_CAVEMAN_FULL_DIRECTIVE);
    expect(
      withPresetOptions(
        "PROMPT",
        presetWith({
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "full" },
        }),
      ),
    ).toBe(`PROMPT\n\n${DEFAULT_CAVEMAN_FULL_DIRECTIVE.trim()}`);
  });

  it("refuses to have its choices array reordered in place", () => {
    const [option] = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);

    swallowingThrow(() => {
      (option.choices as unknown as { value: string }[]).reverse();
    });

    expect(
      presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID)[0].choices.map(
        (choice) => choice.value,
      ),
    ).toEqual(["lite", "full", "ultra"]);
  });

  it("refuses to have a definition's defaultValue reassigned", () => {
    const [option] = presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID);

    swallowingThrow(() => {
      (option as unknown as { defaultValue: string }).defaultValue = "lite";
    });

    expect(
      presetOptionDefinitions(DEFAULT_CAVEMAN_PRESET_ID)[0].defaultValue,
    ).toBe("full");
  });

  it("freezes every reachable node, not just the ones with a test above", () => {
    // The structural pin, so a SECOND preset option added later cannot ship
    // unfrozen just because nobody wrote it a bespoke mutation test.
    for (const presetId of [DEFAULT_CAVEMAN_PRESET_ID]) {
      const definitions = presetOptionDefinitions(presetId);
      expect(Object.isFrozen(definitions)).toBe(true);
      for (const definition of definitions) {
        expect(Object.isFrozen(definition)).toBe(true);
        expect(Object.isFrozen(definition.choices)).toBe(true);
        for (const choice of definition.choices) {
          expect(Object.isFrozen(choice)).toBe(true);
        }
      }
    }
    // The shared empty singleton every other preset gets back.
    expect(Object.isFrozen(presetOptionDefinitions("no-such-preset"))).toBe(
      true,
    );
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
        presetWith({
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
        }),
        CAVEMAN_MODE_OPTION_KEY,
      ),
    ).toBe("ultra");
  });

  it("falls back to the declared default when the option is absent", () => {
    expect(
      resolvePresetOptionValue(
        presetWith({ id: DEFAULT_CAVEMAN_PRESET_ID }),
        CAVEMAN_MODE_OPTION_KEY,
      ),
    ).toBe("full");
  });

  it("falls back to the declared default when the stored value is unrecognized", () => {
    expect(
      resolvePresetOptionValue(
        presetWith({
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "extreme" },
        }),
        CAVEMAN_MODE_OPTION_KEY,
      ),
    ).toBe("full");
  });

  it("returns undefined for an option the preset never declared", () => {
    expect(
      resolvePresetOptionValue(
        presetWith({ id: DEFAULT_CAVEMAN_PRESET_ID }),
        "notAnOption",
      ),
    ).toBeUndefined();
    expect(
      resolvePresetOptionValue(
        presetWith({
          id: DEFAULT_CORRECTION_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
        }),
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
    const preset = presetWith({ id: DEFAULT_CORRECTION_PRESET_ID });

    // `toBe`, not `toEqual`: the whole point is that nothing was rebuilt.
    expect(withPresetOptions(basePrompt, preset)).toBe(basePrompt);
    expect(withPresetOptions(raggedPrompt, preset)).toBe(raggedPrompt);
    expect(withPresetOptions("", preset)).toBe("");
  });

  it("is still the identity when a preset with no options carries stray extraOptions", () => {
    const preset = presetWith({
      id: DEFAULT_CORRECTION_PRESET_ID,
      extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
    });

    expect(withPresetOptions(basePrompt, preset)).toBe(basePrompt);
    expect(withPresetOptions(raggedPrompt, preset)).toBe(raggedPrompt);
  });

  it("leaves the declaring preset's own prompt untouched ahead of the fragment", () => {
    expect(
      withPresetOptions(
        raggedPrompt,
        presetWith({
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "lite" },
        }),
      ),
    ).toBe(`${raggedPrompt}\n\n${DEFAULT_CAVEMAN_LITE_DIRECTIVE}`);
  });

  it("appends the selected fragment after the system prompt", () => {
    const composed = withPresetOptions(
      basePrompt,
      presetWith({
        id: DEFAULT_CAVEMAN_PRESET_ID,
        extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
      }),
    );

    expect(composed).toBe(`${basePrompt}\n\n${DEFAULT_CAVEMAN_ULTRA_DIRECTIVE}`);
  });

  it("appends the default fragment when the preset stores no selection", () => {
    expect(
      withPresetOptions(
        basePrompt,
        presetWith({ id: DEFAULT_CAVEMAN_PRESET_ID }),
      ),
    ).toBe(`${basePrompt}\n\n${DEFAULT_CAVEMAN_FULL_DIRECTIVE}`);
  });

  it("appends the default fragment when the stored selection is unrecognized", () => {
    expect(
      withPresetOptions(
        basePrompt,
        presetWith({
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "extreme" },
        }),
      ),
    ).toBe(`${basePrompt}\n\n${DEFAULT_CAVEMAN_FULL_DIRECTIVE}`);
  });
});
