/**
 * @file normalizeCorrectionSettings.test.ts
 * @description TDD tests for the Translate built-in preset merge logic.
 * Pure unit tests — no Electron, no IPC, no network.
 */
// Mocks — must be hoisted before imports
import { describe, expect, it, vi } from "vitest";
// Mock electron-store to avoid "projectName" initialization error in test env.
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
// Mock electron to avoid Notification / ipcMain access in tests
vi.mock("electron", () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));
// Imports (after mocks)
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_ASK_PRESET_PROMPT,
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
  DEFAULT_TRANSLATE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_PROMPT,
} from "~/prompts/correction";
import {
  normalizeCorrectionSettings,
  getDefaultCorrectionSettings,
  type LegacyTranslateSettings,
} from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Tests: Translate built-in merge
// ---------------------------------------------------------------------------

describe("normalizeCorrectionSettings — Translate built-in preset injection", () => {
  it("injects Translate preset when stored presets lack it", () => {
    const stored = {
      presets: [
        {
          id: "correction",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "summarize",
          name: "Summarize",
          hotkey: "Control+Shift+S",
          systemPrompt: "Summarize.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "prompt-optimization",
          name: "Prompt optimization",
          hotkey: "Control+Shift+D",
          systemPrompt: "Optimize the prompt.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    };

    const result = normalizeCorrectionSettings(stored);
    const translatePreset = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );

    expect(translatePreset).toBeDefined();
    expect(translatePreset?.isBuiltIn).toBe(true);
    expect(translatePreset?.hotkey).toBe("Control+Shift+T");
  });

  it("preserves user's custom hotkey for Translate preset on merge", () => {
    const stored = {
      presets: [
        {
          id: "correction",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "translate",
          name: "Translate",
          hotkey: "Control+Shift+Y", // user changed it
          systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT,
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "summarize",
          name: "Summarize",
          hotkey: "Control+Shift+S",
          systemPrompt: "Summarize.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "prompt-optimization",
          name: "Prompt optimization",
          hotkey: "Control+Shift+D",
          systemPrompt: "Optimize.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    };

    const result = normalizeCorrectionSettings(stored);
    const translatePreset = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );

    // User's hotkey must be preserved
    expect(translatePreset?.hotkey).toBe("Control+Shift+Y");
  });

  it("preserves custom presets after merge and does not duplicate them", () => {
    const stored = {
      presets: [
        {
          id: "correction",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "custom-123",
          name: "My Custom",
          hotkey: "Control+Shift+M",
          systemPrompt: "Custom.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: false,
        },
        {
          id: "summarize",
          name: "Summarize",
          hotkey: "Control+Shift+S",
          systemPrompt: "Summarize.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "prompt-optimization",
          name: "Prompt optimization",
          hotkey: "Control+Shift+D",
          systemPrompt: "Optimize.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    };

    const result = normalizeCorrectionSettings(stored);

    const customPreset = result.presets.find((p) => p.id === "custom-123");
    expect(customPreset).toBeDefined();
    expect(customPreset?.name).toBe("My Custom");

    // No duplicates
    const customOccurrences = result.presets.filter(
      (p) => p.id === "custom-123",
    );
    expect(customOccurrences).toHaveLength(1);
  });

  it("deduplicates presets with duplicate IDs", () => {
    const stored = {
      presets: [
        {
          id: "correction",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "correction",
          name: "Correction Duplicate",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar duplicate.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "summarize",
          name: "Summarize",
          hotkey: "Control+Shift+S",
          systemPrompt: "Summarize.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: "prompt-optimization",
          name: "Prompt optimization",
          hotkey: "Control+Shift+D",
          systemPrompt: "Optimize.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    };

    const result = normalizeCorrectionSettings(stored);
    const correctionPresets = result.presets.filter(
      (p) => p.id === "correction",
    );
    expect(correctionPresets).toHaveLength(1);
  });
});

describe("getDefaultCorrectionSettings — returns 7 built-in presets including Business Writing, Structured Text and Ask AI", () => {
  it("returns exactly 7 presets", () => {
    const defaults = getDefaultCorrectionSettings();
    expect(defaults.presets).toHaveLength(7);
  });

  it("includes the Translate preset with isBuiltIn: true", () => {
    const defaults = getDefaultCorrectionSettings();
    const translatePreset = defaults.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );

    expect(translatePreset).toBeDefined();
    expect(translatePreset?.isBuiltIn).toBe(true);
    expect(translatePreset?.hotkey).toBe("Control+Shift+T");
  });

  it("includes correction, summarize, prompt-optimization, translate, business-writing, structured-text, ask in order", () => {
    const defaults = getDefaultCorrectionSettings();
    const ids = defaults.presets.map((p) => p.id);

    expect(ids).toEqual([
      "correction",
      "summarize",
      "prompt-optimization",
      "translate",
      DEFAULT_BUSINESS_WRITING_PRESET_ID,
      DEFAULT_STRUCTURED_TEXT_PRESET_ID,
      DEFAULT_ASK_PRESET_ID,
    ]);
  });

  it("includes Ask AI last, with the exact field values", () => {
    const defaults = getDefaultCorrectionSettings();
    const ask = defaults.presets.find((p) => p.id === DEFAULT_ASK_PRESET_ID);

    expect(defaults.presets.at(-1)?.id).toBe(DEFAULT_ASK_PRESET_ID);
    expect(ask).toEqual({
      id: DEFAULT_ASK_PRESET_ID,
      name: "Ask AI",
      hotkey: "Control+Shift+A",
      systemPrompt: DEFAULT_ASK_PRESET_PROMPT,
      model: "",
      isBuiltIn: true,
      reasoning: "low",
      requiresInput: true,
      outputMode: "popup",
      markdownOutput: true,
    });
  });

  it("gives no built-in but Ask the three Ask-only fields", () => {
    const defaults = getDefaultCorrectionSettings();

    for (const preset of defaults.presets) {
      if (preset.id === DEFAULT_ASK_PRESET_ID) continue;
      expect(preset).not.toHaveProperty("requiresInput");
      expect(preset).not.toHaveProperty("outputMode");
      expect(preset).not.toHaveProperty("markdownOutput");
    }
  });

  it("includes Business Writing with the exact field values", () => {
    const defaults = getDefaultCorrectionSettings();
    const businessWriting = defaults.presets.find(
      (p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID,
    );

    expect(businessWriting).toBeDefined();
    expect(businessWriting?.name).toBe("Business Writing");
    expect(businessWriting?.hotkey).toBe("Control+Shift+B");
    expect(businessWriting?.systemPrompt).toBe(
      DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
    );
    expect(businessWriting?.model).toBe("");
    expect(businessWriting?.isBuiltIn).toBe(true);
    expect(businessWriting?.reasoning).toBe("low");
  });

  it("includes Prompt optimization with Low reasoning", () => {
    const defaults = getDefaultCorrectionSettings();
    const promptOptimization = defaults.presets.find(
      (p) => p.id === "prompt-optimization",
    );

    expect(promptOptimization?.reasoning).toBe("low");
  });

  it("includes Context-Aware Structured Text with the exact field values", () => {
    const defaults = getDefaultCorrectionSettings();
    const structuredText = defaults.presets.find(
      (p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    );

    expect(structuredText).toBeDefined();
    expect(structuredText?.name).toBe("Context-Aware Structured Text");
    expect(structuredText?.hotkey).toBe("Control+Shift+R");
    expect(structuredText?.systemPrompt).toBe(
      DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
    );
    expect(structuredText?.model).toBe("");
    expect(structuredText?.isBuiltIn).toBe(true);
    expect(structuredText).not.toHaveProperty("reasoning");
  });

  it("keeps Business Writing and Structured Text hotkeys distinct from every other default and app hotkey", () => {
    const defaults = getDefaultCorrectionSettings();
    const hotkeys = defaults.presets.map((p) => p.hotkey);

    // No two default presets may share an accelerator.
    expect(new Set(hotkeys).size).toBe(hotkeys.length);
    expect(hotkeys).toContain("Control+Shift+B");
    expect(hotkeys).toContain("Control+Shift+R");
    expect(hotkeys).toContain("Control+Shift+A");
    // Distinct from the static app hotkeys (promptGen/profileSwitch) and devtools.
    expect(hotkeys).not.toContain("Control+Shift+G");
    expect(hotkeys).not.toContain("Control+Shift+P");
    expect(hotkeys).not.toContain("F12");
  });
});

describe("normalizeCorrectionSettings — legacy path (no presets array)", () => {
  it("returns all 7 built-in presets when input has no presets array", () => {
    // Simulates a very old profile that predates the preset system (no presets key at all)
    const result = normalizeCorrectionSettings({});
    expect(result.presets).toHaveLength(7);
    const ids = result.presets.map((p) => p.id);
    expect(ids).toContain("correction");
    expect(ids).toContain("summarize");
    expect(ids).toContain("prompt-optimization");
    expect(ids).toContain(DEFAULT_TRANSLATE_PRESET_ID);
    expect(ids).toContain(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids).toContain(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
    expect(ids).toContain(DEFAULT_ASK_PRESET_ID);
  });

  it("returns all 7 built-in presets when input is null", () => {
    const result = normalizeCorrectionSettings(null);
    expect(result.presets).toHaveLength(7);
    expect(
      result.presets.find((p) => p.id === DEFAULT_TRANSLATE_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_ASK_PRESET_ID),
    ).toBeDefined();
  });

  it("returns all 7 built-in presets when input is undefined", () => {
    const result = normalizeCorrectionSettings(undefined);
    expect(result.presets).toHaveLength(7);
    expect(
      result.presets.find((p) => p.id === DEFAULT_TRANSLATE_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_ASK_PRESET_ID),
    ).toBeDefined();
  });

  it("returns all 7 built-in presets when input is an empty object ({})", () => {
    const result = normalizeCorrectionSettings({});
    expect(
      result.presets.find((p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID)
        ?.isBuiltIn,
    ).toBe(true);
    expect(
      result.presets.find((p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID)
        ?.isBuiltIn,
    ).toBe(true);
  });

  it("migrates legacy userInput into correction preset systemPrompt", () => {
    // Old-style stored object with userInput but no presets
    const result = normalizeCorrectionSettings({
      userInput: "Custom prompt text",
    });
    const correctionPreset = result.presets.find((p) => p.id === "correction");
    expect(correctionPreset?.systemPrompt).toContain("Custom prompt text");
  });

  it("includes all 7 built-in presets in order including business-writing, structured-text and ask at positions 4, 5 and 6", () => {
    const result = normalizeCorrectionSettings({});
    const ids = result.presets.map((p) => p.id);
    expect(ids[0]).toBe("correction");
    expect(ids[1]).toBe("summarize");
    expect(ids[2]).toBe("prompt-optimization");
    expect(ids[3]).toBe(DEFAULT_TRANSLATE_PRESET_ID);
    expect(ids[4]).toBe(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids[5]).toBe(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
    expect(ids[6]).toBe(DEFAULT_ASK_PRESET_ID);
  });
});

describe("normalizeCorrectionSettings — Business Writing / Structured Text built-in materialization", () => {
  const storedFourWithoutNewBuiltIns = {
    presets: [
      {
        id: "correction",
        name: "Correction",
        hotkey: "Control+Shift+F",
        systemPrompt: "Fix grammar.",
        model: "openai/gpt-4.1-mini",
        isBuiltIn: true,
      },
      {
        id: "summarize",
        name: "Summarize",
        hotkey: "Control+Shift+S",
        systemPrompt: "Summarize.",
        model: "openai/gpt-4.1-mini",
        isBuiltIn: true,
      },
      {
        id: "prompt-optimization",
        name: "Prompt optimization",
        hotkey: "Control+Shift+D",
        systemPrompt: "Optimize.",
        model: "openai/gpt-4.1-mini",
        isBuiltIn: true,
      },
      {
        id: DEFAULT_TRANSLATE_PRESET_ID,
        name: "Translate",
        hotkey: "Control+Shift+T",
        systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT,
        model: "openai/gpt-4.1-mini",
        isBuiltIn: true,
      },
    ],
    selectedPresetId: "correction",
  };

  it("materializes both new built-ins when a stored array predates them", () => {
    const result = normalizeCorrectionSettings(storedFourWithoutNewBuiltIns);

    const businessWriting = result.presets.find(
      (p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID,
    );
    const structuredText = result.presets.find(
      (p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    );

    expect(businessWriting).toBeDefined();
    expect(businessWriting?.isBuiltIn).toBe(true);
    expect(businessWriting?.hotkey).toBe("Control+Shift+B");
    expect(businessWriting?.systemPrompt).toBe(
      DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
    );

    expect(structuredText).toBeDefined();
    expect(structuredText?.isBuiltIn).toBe(true);
    expect(structuredText?.hotkey).toBe("Control+Shift+R");
    expect(structuredText?.systemPrompt).toBe(
      DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
    );

    expect(result.presets).toHaveLength(7);
  });

  it("migrates missing reasoning only on the two Low-default built-ins", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        ...storedFourWithoutNewBuiltIns.presets,
        {
          id: DEFAULT_BUSINESS_WRITING_PRESET_ID,
          name: "Business Writing",
          hotkey: "Control+Shift+B",
          systemPrompt: DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
          model: "",
          isBuiltIn: true,
        },
        {
          id: "custom-without-reasoning",
          name: "Custom without reasoning",
          hotkey: "Control+Shift+M",
          systemPrompt: "Custom.",
          model: "",
          isBuiltIn: false,
        },
      ],
      selectedPresetId: "prompt-optimization",
    });

    expect(
      result.presets.find((preset) => preset.id === "prompt-optimization")
        ?.reasoning,
    ).toBe("low");
    expect(
      result.presets.find(
        (preset) => preset.id === DEFAULT_BUSINESS_WRITING_PRESET_ID,
      )?.reasoning,
    ).toBe("low");
    expect(
      result.presets.find((preset) => preset.id === "custom-without-reasoning"),
    ).not.toHaveProperty("reasoning");
  });

  it("preserves custom presets, does not duplicate the new built-ins, and sorts customs after all seven built-ins", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        ...storedFourWithoutNewBuiltIns.presets,
        {
          id: "custom-999",
          name: "My Custom",
          hotkey: "Control+Shift+M",
          systemPrompt: "Custom.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: false,
        },
      ],
      selectedPresetId: "correction",
    });

    const ids = result.presets.map((p) => p.id);
    expect(ids).toEqual([
      "correction",
      "summarize",
      "prompt-optimization",
      DEFAULT_TRANSLATE_PRESET_ID,
      DEFAULT_BUSINESS_WRITING_PRESET_ID,
      DEFAULT_STRUCTURED_TEXT_PRESET_ID,
      DEFAULT_ASK_PRESET_ID,
      "custom-999",
    ]);
    expect(result.presets.filter((p) => p.id === "custom-999")).toHaveLength(1);
  });

  it("round-trips a stored user-edited copy of Business Writing verbatim", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        ...storedFourWithoutNewBuiltIns.presets,
        {
          id: DEFAULT_BUSINESS_WRITING_PRESET_ID,
          name: "My Business Writing",
          hotkey: "Control+Alt+B",
          systemPrompt: "My custom business writing prompt.",
          model: "openai/gpt-4o",
          isBuiltIn: true,
          reasoning: "high",
        },
      ],
      selectedPresetId: "correction",
    });

    const businessWriting = result.presets.find(
      (p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID,
    );
    expect(businessWriting).toEqual({
      id: DEFAULT_BUSINESS_WRITING_PRESET_ID,
      name: "My Business Writing",
      hotkey: "Control+Alt+B",
      systemPrompt: "My custom business writing prompt.",
      model: "openai/gpt-4o",
      isBuiltIn: true,
      reasoning: "high",
    });
  });

  it("keeps a stored Prompt optimization reasoning override", () => {
    const storedPromptOptimization = storedFourWithoutNewBuiltIns.presets.find(
      (preset) => preset.id === "prompt-optimization",
    );
    expect(storedPromptOptimization).toBeDefined();

    const result = normalizeCorrectionSettings({
      presets: storedFourWithoutNewBuiltIns.presets.map((preset) =>
        preset.id === "prompt-optimization"
          ? { ...preset, reasoning: "high" as const }
          : preset,
      ),
      selectedPresetId: "prompt-optimization",
    });

    expect(
      result.presets.find((preset) => preset.id === "prompt-optimization")
        ?.reasoning,
    ).toBe("high");
  });

  it("round-trips a stored user-edited copy of Structured Text verbatim", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        ...storedFourWithoutNewBuiltIns.presets,
        {
          id: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
          name: "My Structured Text",
          hotkey: "Control+Alt+R",
          systemPrompt: "My custom structured text prompt.",
          model: "openai/gpt-4o",
          isBuiltIn: true,
          reasoning: "low",
        },
      ],
      selectedPresetId: "correction",
    });

    const structuredText = result.presets.find(
      (p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    );
    expect(structuredText).toEqual({
      id: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
      name: "My Structured Text",
      hotkey: "Control+Alt+R",
      systemPrompt: "My custom structured text prompt.",
      model: "openai/gpt-4o",
      isBuiltIn: true,
      reasoning: "low",
    });
  });
});

describe("normalizeCorrectionSettings — legacy standalone-Translate migration", () => {
  const legacyTranslate = {
    destinationLang: "French",
    includeExplanation: true,
    model: "openai/gpt-4o",
  };

  it("carries legacy translate model into the injected Translate preset", () => {
    // Upgrading user: stored presets have no Translate preset yet.
    const stored = {
      presets: [
        {
          id: "correction",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    };

    const result = normalizeCorrectionSettings(stored, legacyTranslate);
    const translate = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );
    expect(translate?.model).toBe("openai/gpt-4o");
  });

  it("augments the Translate prompt with the legacy target language", () => {
    const result = normalizeCorrectionSettings({}, legacyTranslate);
    const translate = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );
    expect(translate?.systemPrompt).toContain(
      DEFAULT_TRANSLATE_PRESET_PROMPT.trim(),
    );
    expect(translate?.systemPrompt).toContain("French");
    expect(translate?.systemPrompt).toContain("explanation");
  });

  it("migrates legacy translate even on the no-presets-array legacy path", () => {
    const result = normalizeCorrectionSettings({}, legacyTranslate);
    const translate = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );
    expect(translate?.model).toBe("openai/gpt-4o");
  });

  it("does NOT override a Translate preset the user already has (no clobber)", () => {
    // User already migrated: stored config already contains a Translate preset
    // with their own model — legacy data must not overwrite it.
    const stored = {
      presets: [
        {
          id: "correction",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
        {
          id: DEFAULT_TRANSLATE_PRESET_ID,
          name: "Translate",
          hotkey: "Control+Shift+T",
          systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT,
          model: "anthropic/claude-3.5",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    };

    const result = normalizeCorrectionSettings(stored, legacyTranslate);
    const translate = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );
    expect(translate?.model).toBe("anthropic/claude-3.5");
  });

  it("leaves the default Translate preset untouched when no legacy data", () => {
    const result = normalizeCorrectionSettings({});
    const translate = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );
    expect(translate?.systemPrompt).toBe(
      DEFAULT_TRANSLATE_PRESET_PROMPT.trim(),
    );
  });

  it("never rewrites the Translate hotkey, so it cannot steal a stored accelerator", () => {
    // The legacy migration runs AFTER the anti-theft guard, so a legacy
    // accelerator plumbed into it would restore exactly the steal the guard
    // exists to prevent. `LegacyTranslateSettings` therefore carries no
    // `hotkey` field; the cast pins that a stray one on the persisted JSON
    // stays inert instead of reaching the Translate preset.
    const legacyWithStrayHotkey = {
      destinationLang: "French",
      hotkey: "Control+Shift+F",
    } as LegacyTranslateSettings;

    const result = normalizeCorrectionSettings(
      {
        presets: [
          {
            id: "correction",
            name: "Correction",
            hotkey: "Control+Shift+F",
            systemPrompt: "Fix grammar.",
            model: "openai/gpt-4.1-mini",
            isBuiltIn: true,
          },
        ],
        selectedPresetId: "correction",
      },
      legacyWithStrayHotkey,
    );

    const correction = result.presets.find((p) => p.id === "correction");
    const translate = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );

    // The rest of the migration still ran…
    expect(translate?.systemPrompt).toContain("French");
    // …but the accelerators stay disjoint.
    expect(correction?.hotkey).toBe("Control+Shift+F");
    expect(translate?.hotkey).toBe("Control+Shift+T");
    expect(translate?.hotkey).not.toBe(correction?.hotkey);
  });
});

// ---------------------------------------------------------------------------
// Tests: a materialized built-in must never steal a stored preset's hotkey
// ---------------------------------------------------------------------------

const TRANSLATE_DEFAULT_HOTKEY = "Control+Shift+T";

const storedCorrection = {
  id: "correction",
  name: "Correction",
  hotkey: "Control+Shift+F",
  systemPrompt: "Fix grammar.",
  model: "openai/gpt-4.1-mini",
  isBuiltIn: true,
};

const storedSummarize = {
  id: "summarize",
  name: "Summarize",
  hotkey: "Control+Shift+S",
  systemPrompt: "Summarize.",
  model: "openai/gpt-4.1-mini",
  isBuiltIn: true,
};

const storedPromptOptimization = {
  id: "prompt-optimization",
  name: "Prompt optimization",
  hotkey: "Control+Shift+D",
  systemPrompt: "Optimize.",
  model: "openai/gpt-4.1-mini",
  isBuiltIn: true,
};

const storedCustom = (id: string, hotkey: string): Record<string, unknown> => ({
  id,
  name: `Custom ${id}`,
  hotkey,
  systemPrompt: "Custom.",
  model: "openai/gpt-4.1-mini",
  isBuiltIn: false,
});

const hotkeyOf = (
  settings: ReturnType<typeof normalizeCorrectionSettings>,
  id: string,
): string | undefined => settings.presets.find((p) => p.id === id)?.hotkey;

describe("normalizeCorrectionSettings — materialized built-in never steals a stored hotkey", () => {
  it("blanks a materialized built-in whose default hotkey a stored custom preset claims", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedSummarize,
        storedPromptOptimization,
        storedCustom("custom-translate-key", TRANSLATE_DEFAULT_HOTKEY),
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, "custom-translate-key")).toBe(
      TRANSLATE_DEFAULT_HOTKEY,
    );
  });

  // The upgrade path unique to adding Business Writing and Context-Aware
  // Structured Text: a user who already bound one of the two brand-new
  // accelerators to a preset of their own. Every other test in this describe
  // uses Translate's key, so without this case a regression in the guard would
  // let precisely these two new built-ins steal a hotkey on upgrade with the
  // whole suite still green.
  it("blanks both brand-new built-ins when stored custom presets already claim Control+Shift+B and Control+Shift+R", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedCustom("custom-b", "Control+Shift+B"),
        storedCustom("custom-r", "Control+Shift+R"),
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, DEFAULT_STRUCTURED_TEXT_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, "custom-b")).toBe("Control+Shift+B");
    expect(hotkeyOf(result, "custom-r")).toBe("Control+Shift+R");
  });

  it("blanks a materialized built-in when the claimer is another stored built-in", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        // User remapped Summarize onto Translate's default accelerator.
        { ...storedSummarize, hotkey: TRANSLATE_DEFAULT_HOTKEY },
        storedPromptOptimization,
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "summarize")).toBe(TRANSLATE_DEFAULT_HOTKEY);
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe("");
  });

  it("still materializes the built-in itself (present, built-in, prompt intact) when blanked", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedCustom("custom-translate-key", TRANSLATE_DEFAULT_HOTKEY),
      ],
      selectedPresetId: "correction",
    });

    const translate = result.presets.find(
      (p) => p.id === DEFAULT_TRANSLATE_PRESET_ID,
    );
    expect(translate).toBeDefined();
    expect(translate?.isBuiltIn).toBe(true);
    expect(translate?.hotkey).toBe("");
    expect(translate?.systemPrompt).toBe(
      DEFAULT_TRANSLATE_PRESET_PROMPT.trim(),
    );
    // 7 built-ins + the one stored custom preset — blanking drops no preset.
    expect(result.presets).toHaveLength(8);
  });

  it("matches claims trimmed-exact — surrounding whitespace still collides", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedCustom("custom-padded", `  ${TRANSLATE_DEFAULT_HOTKEY}  `),
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "custom-padded")).toBe(TRANSLATE_DEFAULT_HOTKEY);
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe("");
  });

  it("does NOT case-fold — a differently-cased accelerator is not a claim", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedCustom("custom-lowercase", "control+shift+t"),
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "custom-lowercase")).toBe("control+shift+t");
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe(
      TRANSLATE_DEFAULT_HOTKEY,
    );
  });

  it("treats a blank or whitespace-only stored hotkey as no claim", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedCustom("custom-blank", ""),
        storedCustom("custom-spaces", "   "),
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "custom-blank")).toBe("");
    expect(hotkeyOf(result, "custom-spaces")).toBe("");
    // Every materialized built-in keeps its default — "" is not a claim.
    expect(hotkeyOf(result, "summarize")).toBe("Control+Shift+S");
    expect(hotkeyOf(result, "prompt-optimization")).toBe("Control+Shift+D");
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe(
      TRANSLATE_DEFAULT_HOTKEY,
    );
  });
});

describe("normalizeCorrectionSettings — a stored preset's hotkey is never rewritten", () => {
  it("leaves two stored presets colliding with each other alone (validateHotkeys' job)", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedSummarize,
        storedPromptOptimization,
        storedCustom("custom-a", "Control+Shift+M"),
        storedCustom("custom-b", "Control+Shift+M"),
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "custom-a")).toBe("Control+Shift+M");
    expect(hotkeyOf(result, "custom-b")).toBe("Control+Shift+M");
  });

  it("keeps BOTH stored duplicates when they also collide with a materialized built-in", () => {
    // The discriminator against a naive guard that blanks any duplicate hotkey:
    // only the materialized built-in may lose its hotkey, never a stored preset.
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedCustom("custom-a", TRANSLATE_DEFAULT_HOTKEY),
        storedCustom("custom-b", TRANSLATE_DEFAULT_HOTKEY),
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "custom-a")).toBe(TRANSLATE_DEFAULT_HOTKEY);
    expect(hotkeyOf(result, "custom-b")).toBe(TRANSLATE_DEFAULT_HOTKEY);
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe("");
  });

  it("keeps a stored built-in's hotkey even when it duplicates another stored built-in's", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        { ...storedSummarize, hotkey: "Control+Shift+F" },
        storedPromptOptimization,
        { ...storedCustom("custom-c", "Control+Shift+F") },
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "correction")).toBe("Control+Shift+F");
    expect(hotkeyOf(result, "summarize")).toBe("Control+Shift+F");
    expect(hotkeyOf(result, "custom-c")).toBe("Control+Shift+F");
  });

  it("keeps a stored built-in that sits on its own default hotkey", () => {
    // The built-in is stored, not materialized — the guard must not fire on it
    // even though its hotkey equals the default it was seeded from.
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedSummarize,
        storedPromptOptimization,
        {
          id: DEFAULT_TRANSLATE_PRESET_ID,
          name: "Translate",
          hotkey: TRANSLATE_DEFAULT_HOTKEY,
          systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT,
          model: "openai/gpt-4.1-mini",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe(
      TRANSLATE_DEFAULT_HOTKEY,
    );
  });
});

describe("normalizeCorrectionSettings — no collision keeps every default hotkey", () => {
  it("is byte-identical to the defaults on the fresh-install path", () => {
    expect(normalizeCorrectionSettings({})).toEqual(
      getDefaultCorrectionSettings(),
    );
    expect(normalizeCorrectionSettings(null)).toEqual(
      getDefaultCorrectionSettings(),
    );
    expect(normalizeCorrectionSettings(undefined)).toEqual(
      getDefaultCorrectionSettings(),
    );
  });

  it("keeps every materialized default hotkey when stored presets claim other keys", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection, storedCustom("custom-x", "Control+Shift+M")],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "correction")).toBe("Control+Shift+F");
    expect(hotkeyOf(result, "summarize")).toBe("Control+Shift+S");
    expect(hotkeyOf(result, "prompt-optimization")).toBe("Control+Shift+D");
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe(
      TRANSLATE_DEFAULT_HOTKEY,
    );
    expect(hotkeyOf(result, "custom-x")).toBe("Control+Shift+M");
  });

  it("materializes every absent built-in with its default hotkey when nothing is stored but one custom preset", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCustom("custom-only", "Control+Alt+Z")],
      selectedPresetId: "custom-only",
    });

    const defaults = getDefaultCorrectionSettings();
    for (const defaultPreset of defaults.presets) {
      expect(hotkeyOf(result, defaultPreset.id)).toBe(defaultPreset.hotkey);
    }
  });

  it("materializes the original four built-ins on their literal default accelerators", () => {
    // The loop above compares the function's output against the same factory's
    // own output, so a corrupted default literal cancels out on both sides. The
    // loop is kept because it covers built-ins added later with no edit; these
    // literals are what actually pin the four that exist today. (Business
    // Writing and Structured Text are pinned by literal in their own describe.)
    const result = normalizeCorrectionSettings({
      presets: [storedCustom("custom-only", "Control+Alt+Z")],
      selectedPresetId: "custom-only",
    });

    expect(hotkeyOf(result, "correction")).toBe("Control+Shift+F");
    expect(hotkeyOf(result, "summarize")).toBe("Control+Shift+S");
    expect(hotkeyOf(result, "prompt-optimization")).toBe("Control+Shift+D");
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe(
      "Control+Shift+T",
    );
  });
});

describe("normalizeCorrectionSettings — an inherited default hotkey is not a stored claim", () => {
  const storedBuiltInWithoutHotkeyField = {
    id: "summarize",
    name: "Summarize",
    systemPrompt: "Summarize.",
    model: "openai/gpt-4.1-mini",
    isBuiltIn: true,
  };

  it("blanks a built-in's fallback-injected hotkey when a stored preset claims it", () => {
    // The hotkey field — not the whole preset — is what materializes here: the
    // stored built-in has no `hotkey` key, so it inherits its default. Built-ins
    // are emitted first, so that injected default would outrank the stored
    // preset that explicitly holds the accelerator.
    const result = normalizeCorrectionSettings({
      presets: [
        storedBuiltInWithoutHotkeyField,
        storedCustom("mine", "Control+Shift+S"),
      ],
      selectedPresetId: "summarize",
    });

    expect(hotkeyOf(result, "mine")).toBe("Control+Shift+S");
    expect(hotkeyOf(result, "summarize")).toBe("");
  });

  it("blanks an inherited hotkey injected over a non-string stored value", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        { ...storedBuiltInWithoutHotkeyField, hotkey: 42 },
        storedCustom("mine", "Control+Shift+S"),
      ],
      selectedPresetId: "summarize",
    });

    expect(hotkeyOf(result, "mine")).toBe("Control+Shift+S");
    expect(hotkeyOf(result, "summarize")).toBe("");
  });

  it("still inherits the default hotkey when no stored preset claims it", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedBuiltInWithoutHotkeyField,
        storedCustom("mine", "Control+Alt+Z"),
      ],
      selectedPresetId: "summarize",
    });

    expect(hotkeyOf(result, "summarize")).toBe("Control+Shift+S");
    expect(hotkeyOf(result, "mine")).toBe("Control+Alt+Z");
  });

  it("keeps an explicitly stored empty hotkey empty rather than inheriting one", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        { ...storedBuiltInWithoutHotkeyField, hotkey: "" },
        storedCustom("mine", "Control+Alt+Z"),
      ],
      selectedPresetId: "summarize",
    });

    expect(hotkeyOf(result, "summarize")).toBe("");
  });

  it("does not treat a dropped duplicate's hotkey as a claim", () => {
    // The later same-id entry is discarded, so nothing it held may block a
    // materialized built-in from keeping its own default accelerator.
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        {
          ...storedCorrection,
          name: "Correction Duplicate",
          hotkey: TRANSLATE_DEFAULT_HOTKEY,
        },
      ],
      selectedPresetId: "correction",
    });

    expect(result.presets.filter((p) => p.id === "correction")).toHaveLength(1);
    expect(hotkeyOf(result, "correction")).toBe("Control+Shift+F");
    expect(hotkeyOf(result, DEFAULT_TRANSLATE_PRESET_ID)).toBe(
      TRANSLATE_DEFAULT_HOTKEY,
    );
  });
});

/**
 * `registerCorrectionShortcut` treats `promptGen` and `profileSwitch` as
 * reserved and skips any preset hotkey equal to one, logging a warn and nothing
 * else. Both app bindings are user-remappable, so a built-in default can land on
 * one — and until the guard below existed, the preset then showed an assigned
 * hotkey in Settings that could never fire. Business Writing and Structured Text
 * make this reachable for every upgrading user at once (both are materialized on
 * the first read after upgrade), which is why it is pinned here.
 *
 * Reserved accelerators are injected through the third parameter so these cases
 * never depend on `keybindingStore`'s persisted state. Production reads the real
 * bindings through that same parameter's default.
 */
describe("normalizeCorrectionSettings — a materialized default gives up a reserved app accelerator", () => {
  const storedOnly = (...presets: Record<string, unknown>[]) => ({
    presets,
    selectedPresetId: "correction",
  });

  it("blanks Business Writing when promptGen was remapped onto Control+Shift+B", () => {
    const result = normalizeCorrectionSettings(
      storedOnly(storedCorrection),
      undefined,
      ["Control+Shift+B", "Control+Shift+P"],
    );

    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe("");
    // Only the contested one loses its key.
    expect(hotkeyOf(result, DEFAULT_STRUCTURED_TEXT_PRESET_ID)).toBe(
      "Control+Shift+R",
    );
  });

  it("blanks Structured Text when profileSwitch was remapped onto Control+Shift+R", () => {
    const result = normalizeCorrectionSettings(
      storedOnly(storedCorrection),
      undefined,
      ["Control+Shift+G", "Control+Shift+R"],
    );

    expect(hotkeyOf(result, DEFAULT_STRUCTURED_TEXT_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe(
      "Control+Shift+B",
    );
  });

  it("blanks a materialized built-in on a reserved accelerator in the no-presets-array legacy path", () => {
    const result = normalizeCorrectionSettings(
      { userInput: "Legacy prompt." },
      undefined,
      ["Control+Shift+B", "Control+Shift+P"],
    );

    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, "correction")).toBe("Control+Shift+F");
  });

  it("blanks a materialized built-in on a reserved accelerator when the stored value is not an object", () => {
    const result = normalizeCorrectionSettings(undefined, undefined, [
      "Control+Shift+R",
      "Control+Shift+P",
    ]);

    expect(hotkeyOf(result, DEFAULT_STRUCTURED_TEXT_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe(
      "Control+Shift+B",
    );
  });

  it("does NOT rewrite a stored hotkey that sits on a reserved accelerator", () => {
    // Same boundary as the stolen-hotkey guard: a stored hotkey is the user's
    // explicit choice. Blocking that collision stays `validateHotkeys`' pre-save
    // job, so this preset keeps a key that will not register.
    const result = normalizeCorrectionSettings(
      storedOnly(storedCorrection, storedCustom("mine", "Control+Shift+B")),
      undefined,
      ["Control+Shift+B", "Control+Shift+P"],
    );

    expect(hotkeyOf(result, "mine")).toBe("Control+Shift+B");
    // The default still gives its own copy up — the stored preset claimed it.
    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe("");
  });

  it("leaves all seven defaults intact under the DEFAULT app bindings", () => {
    // Ctrl+Shift+G / Ctrl+Shift+P collide with nothing, so an over-broad guard
    // that blanked hotkeys unconditionally would fail here.
    const result = normalizeCorrectionSettings(
      storedOnly(storedCorrection),
      undefined,
      ["Control+Shift+G", "Control+Shift+P"],
    );

    expect(result.presets.map((p) => p.hotkey)).toEqual([
      "Control+Shift+F",
      "Control+Shift+S",
      "Control+Shift+D",
      "Control+Shift+T",
      "Control+Shift+B",
      "Control+Shift+R",
      "Control+Shift+A",
    ]);
  });

  it("ignores blank and whitespace-only reserved entries", () => {
    const result = normalizeCorrectionSettings(
      storedOnly(storedCorrection),
      undefined,
      ["", "   "],
    );

    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe(
      "Control+Shift+B",
    );
    expect(hotkeyOf(result, DEFAULT_STRUCTURED_TEXT_PRESET_ID)).toBe(
      "Control+Shift+R",
    );
  });

  it("matches a reserved accelerator through surrounding whitespace", () => {
    const result = normalizeCorrectionSettings(
      storedOnly(storedCorrection),
      undefined,
      ["  Control+Shift+B  ", "Control+Shift+P"],
    );

    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe("");
  });
});

/**
 * `normalizeCorrectionSettings` does NOT spread the stored preset — it rebuilds
 * one from an explicit field list. A field missing from that list is discarded
 * on EVERY read of `settingsCorrect`, which is what both
 * `registerCorrectionShortcut` and `fixGrammar` call. Ask would then look
 * correct in Settings and behave exactly like Correction: no error, no log.
 * These cases are what pin the three new fields into that list.
 */
describe("normalizeCorrectionSettings — Ask's requiresInput / outputMode / markdownOutput survive the rebuild", () => {
  const askOf = (settings: ReturnType<typeof normalizeCorrectionSettings>) =>
    settings.presets.find((preset) => preset.id === DEFAULT_ASK_PRESET_ID);

  it("round-trips a stored user-edited copy of Ask verbatim, all three fields intact", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        {
          id: DEFAULT_ASK_PRESET_ID,
          name: "My Ask",
          hotkey: "Control+Alt+A",
          systemPrompt: "Answer the question.",
          model: "openai/gpt-4o",
          isBuiltIn: true,
          reasoning: "high",
          requiresInput: true,
          outputMode: "paste",
          markdownOutput: false,
        },
      ],
      selectedPresetId: "correction",
    });

    expect(askOf(result)).toEqual({
      id: DEFAULT_ASK_PRESET_ID,
      name: "My Ask",
      hotkey: "Control+Alt+A",
      systemPrompt: "Answer the question.",
      model: "openai/gpt-4o",
      isBuiltIn: true,
      reasoning: "high",
      requiresInput: true,
      outputMode: "paste",
      markdownOutput: false,
    });
  });

  it("materializes Ask with all three fields on a store that predates it, last among built-ins and before any custom", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        storedSummarize,
        storedPromptOptimization,
        storedCustom("custom-999", "Control+Shift+M"),
      ],
      selectedPresetId: "correction",
    });

    expect(askOf(result)).toEqual({
      id: DEFAULT_ASK_PRESET_ID,
      name: "Ask AI",
      hotkey: "Control+Shift+A",
      systemPrompt: DEFAULT_ASK_PRESET_PROMPT,
      model: "",
      isBuiltIn: true,
      reasoning: "low",
      requiresInput: true,
      outputMode: "popup",
      markdownOutput: true,
    });

    const ids = result.presets.map((preset) => preset.id);
    expect(ids.indexOf(DEFAULT_ASK_PRESET_ID)).toBe(
      ids.indexOf(DEFAULT_STRUCTURED_TEXT_PRESET_ID) + 1,
    );
    expect(ids.indexOf(DEFAULT_ASK_PRESET_ID)).toBeLessThan(
      ids.indexOf("custom-999"),
    );
  });

  it("drops an unrecognized stored outputMode rather than persisting it", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        {
          ...storedCustom("custom-mode", "Control+Shift+M"),
          outputMode: "banana",
          markdownOutput: "yes",
          requiresInput: "sure",
        },
        {
          id: DEFAULT_ASK_PRESET_ID,
          name: "Ask AI",
          hotkey: "Control+Shift+A",
          systemPrompt: "Answer.",
          model: "",
          isBuiltIn: true,
          outputMode: "banana",
          markdownOutput: "yes",
        },
      ],
      selectedPresetId: "correction",
    });

    // A non-built-in has no default to fall back on, so the garbage is gone.
    const custom = result.presets.find((p) => p.id === "custom-mode");
    expect(custom).not.toHaveProperty("outputMode");
    expect(custom).not.toHaveProperty("markdownOutput");
    expect(custom).not.toHaveProperty("requiresInput");

    // Ask falls back to its built-in default, the same rule name/hotkey/model
    // follow — a corrupted value must not silently turn the markdown popup off.
    expect(askOf(result)?.outputMode).toBe("popup");
    expect(askOf(result)?.markdownOutput).toBe(true);
  });

  it("keeps a recognized stored inherit override on Ask", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        {
          id: DEFAULT_ASK_PRESET_ID,
          name: "Ask AI",
          hotkey: "Control+Shift+A",
          systemPrompt: "Answer.",
          model: "",
          isBuiltIn: true,
          outputMode: "inherit",
        },
      ],
      selectedPresetId: "correction",
    });

    expect(askOf(result)?.outputMode).toBe("inherit");
  });

  it("restores requiresInput from the built-in default when a stored Ask row lost it", () => {
    // Without this, that user's Ask hotkey aborts on an empty selection forever
    // — no error, no log. A recognized built-in therefore takes the default's
    // value; only the two preference fields honour a stored override.
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        {
          id: DEFAULT_ASK_PRESET_ID,
          name: "Ask AI",
          hotkey: "Control+Shift+A",
          systemPrompt: "Answer.",
          model: "",
          isBuiltIn: true,
        },
      ],
      selectedPresetId: "correction",
    });

    expect(askOf(result)?.requiresInput).toBe(true);
  });

  it("ignores a stored requiresInput: false on Ask — the default wins for a built-in", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        {
          id: DEFAULT_ASK_PRESET_ID,
          name: "Ask AI",
          hotkey: "Control+Shift+A",
          systemPrompt: "Answer.",
          model: "",
          isBuiltIn: true,
          requiresInput: false,
        },
      ],
      selectedPresetId: "correction",
    });

    expect(askOf(result)?.requiresInput).toBe(true);
  });

  it("never gives another built-in the three Ask-only fields, stored or materialized", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        // A hand-edited Correction row cannot opt itself into the Ask flow:
        // built-ins take `requiresInput` from their own default (undefined).
        {
          ...storedCorrection,
          requiresInput: true,
          outputMode: "popup",
          markdownOutput: true,
        },
      ],
      selectedPresetId: "correction",
    });

    const correction = result.presets.find((p) => p.id === "correction");
    expect(correction).not.toHaveProperty("requiresInput");
    // outputMode/markdownOutput ARE per-preset preferences, so a stored value
    // on any preset stands — only `requiresInput` is default-governed.
    expect(correction?.outputMode).toBe("popup");
    expect(correction?.markdownOutput).toBe(true);
  });

  it("keeps a non-built-in's own requiresInput, which has no default to inherit", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        storedCorrection,
        { ...storedCustom("custom-ask", "Control+Alt+K"), requiresInput: true },
      ],
      selectedPresetId: "correction",
    });

    expect(
      result.presets.find((p) => p.id === "custom-ask")?.requiresInput,
    ).toBe(true);
  });
});

describe("normalizeCorrectionSettings — Ask relinquishes its default hotkey on collision", () => {
  it("blanks Ask when a stored preset already claims Control+Shift+A", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection, storedCustom("custom-a", "Control+Shift+A")],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, DEFAULT_ASK_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, "custom-a")).toBe("Control+Shift+A");
    // Blanking the hotkey must not cost Ask the fields that define its flow.
    expect(
      result.presets.find((p) => p.id === DEFAULT_ASK_PRESET_ID),
    ).toMatchObject({
      isBuiltIn: true,
      requiresInput: true,
      outputMode: "popup",
      markdownOutput: true,
    });
  });

  it("blanks Ask when promptGen was remapped onto Control+Shift+A", () => {
    const result = normalizeCorrectionSettings(
      { presets: [storedCorrection], selectedPresetId: "correction" },
      undefined,
      ["Control+Shift+A", "Control+Shift+P"],
    );

    expect(hotkeyOf(result, DEFAULT_ASK_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, DEFAULT_STRUCTURED_TEXT_PRESET_ID)).toBe(
      "Control+Shift+R",
    );
  });

  it("blanks Ask when profileSwitch was remapped onto Control+Shift+A", () => {
    const result = normalizeCorrectionSettings(
      { presets: [storedCorrection], selectedPresetId: "correction" },
      undefined,
      ["Control+Shift+G", "Control+Shift+A"],
    );

    expect(hotkeyOf(result, DEFAULT_ASK_PRESET_ID)).toBe("");
  });

  it("blanks Ask on a reserved accelerator through the no-presets-array legacy path", () => {
    const result = normalizeCorrectionSettings({ userInput: "Legacy." }, undefined, [
      "Control+Shift+A",
      "Control+Shift+P",
    ]);

    expect(hotkeyOf(result, DEFAULT_ASK_PRESET_ID)).toBe("");
    expect(hotkeyOf(result, "correction")).toBe("Control+Shift+F");
  });

  it("does NOT rewrite a stored Ask hotkey that sits on a reserved accelerator", () => {
    const result = normalizeCorrectionSettings(
      {
        presets: [
          storedCorrection,
          {
            id: DEFAULT_ASK_PRESET_ID,
            name: "Ask AI",
            hotkey: "Control+Shift+A",
            systemPrompt: "Answer.",
            model: "",
            isBuiltIn: true,
          },
        ],
        selectedPresetId: "correction",
      },
      undefined,
      ["Control+Shift+A", "Control+Shift+P"],
    );

    expect(hotkeyOf(result, DEFAULT_ASK_PRESET_ID)).toBe("Control+Shift+A");
  });
});
