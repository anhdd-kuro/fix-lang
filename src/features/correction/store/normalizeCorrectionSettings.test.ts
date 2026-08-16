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
  COMBO_CANCEL_ACCELERATOR,
  COMBO_MAX_STEPS,
  COMBO_MIN_STEPS,
} from "~/features/correction/shared/comboValidation";
import {
  normalizeCorrectionSettings,
  getDefaultCorrectionSettings,
  readReservedAppAccelerators,
  type LegacyTranslateSettings,
} from "~/features/providers/store/apiStore";
import { DEFAULT_PERFECT_PROMPT_COMBO_ID } from "~/prompts";
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_ASK_PRESET_PROMPT,
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_BUSINESS_WRITING_PRESET_PROMPT,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_PRESET_PROMPT,
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_PROMPT,
  DEFAULT_TRANSLATE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_PROMPT,
} from "~/prompts/correction";

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

describe("getDefaultCorrectionSettings — returns 8 built-in presets including Business Writing, Structured Text, Ask AI and Caveman", () => {
  it("returns exactly 8 presets", () => {
    const defaults = getDefaultCorrectionSettings();
    expect(defaults.presets).toHaveLength(8);
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

  it("includes correction, summarize, prompt-optimization, translate, business-writing, structured-text, ask, caveman in order", () => {
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
      DEFAULT_CAVEMAN_PRESET_ID,
    ]);
  });

  // Caveman is APPENDED after Ask rather than slotted in, so every index a
  // stored profile or a test already relies on stays put.
  it("includes Caveman last, with the exact field values", () => {
    const defaults = getDefaultCorrectionSettings();
    const caveman = defaults.presets.find(
      (p) => p.id === DEFAULT_CAVEMAN_PRESET_ID,
    );

    expect(defaults.presets.at(-1)?.id).toBe(DEFAULT_CAVEMAN_PRESET_ID);
    expect(caveman).toEqual({
      id: DEFAULT_CAVEMAN_PRESET_ID,
      name: "Caveman",
      hotkey: "Control+Shift+C",
      systemPrompt: DEFAULT_CAVEMAN_PRESET_PROMPT,
      model: "",
      isBuiltIn: true,
      extraOptions: { cavemanMode: "full" },
    });
  });

  // The literal above is an equality, so it already pins absence — but these
  // four have each been added to a built-in by a later card at some point, and
  // a reader deleting one field from the literal would silently drop the guard.
  it("gives Caveman no reasoning, requiresInput, outputMode or markdownOutput", () => {
    const caveman = getDefaultCorrectionSettings().presets.find(
      (p) => p.id === DEFAULT_CAVEMAN_PRESET_ID,
    );

    expect(caveman).not.toHaveProperty("reasoning");
    expect(caveman).not.toHaveProperty("requiresInput");
    expect(caveman).not.toHaveProperty("outputMode");
    expect(caveman).not.toHaveProperty("markdownOutput");
  });

  it("includes Ask AI second-to-last, with the exact field values", () => {
    const defaults = getDefaultCorrectionSettings();
    const ask = defaults.presets.find((p) => p.id === DEFAULT_ASK_PRESET_ID);

    expect(defaults.presets.at(-2)?.id).toBe(DEFAULT_ASK_PRESET_ID);
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

  it("keeps Business Writing, Structured Text and Caveman hotkeys distinct from every other default and app hotkey", () => {
    const defaults = getDefaultCorrectionSettings();
    const hotkeys = defaults.presets.map((p) => p.hotkey);

    // No two default presets may share an accelerator.
    expect(new Set(hotkeys).size).toBe(hotkeys.length);
    expect(hotkeys).toContain("Control+Shift+B");
    expect(hotkeys).toContain("Control+Shift+R");
    expect(hotkeys).toContain("Control+Shift+A");
    expect(hotkeys).toContain("Control+Shift+C");
    // Distinct from the static app hotkeys (promptGen/profileSwitch), the
    // statically reserved combo-cancel chord, and devtools.
    expect(hotkeys).not.toContain("Control+Shift+G");
    expect(hotkeys).not.toContain("Control+Shift+P");
    expect(hotkeys).not.toContain(COMBO_CANCEL_ACCELERATOR);
    expect(hotkeys).not.toContain("F12");
  });
});

describe("normalizeCorrectionSettings — legacy path (no presets array)", () => {
  it("returns all 8 built-in presets when input has no presets array", () => {
    // Simulates a very old profile that predates the preset system (no presets key at all)
    const result = normalizeCorrectionSettings({});
    expect(result.presets).toHaveLength(8);
    const ids = result.presets.map((p) => p.id);
    expect(ids).toContain("correction");
    expect(ids).toContain("summarize");
    expect(ids).toContain("prompt-optimization");
    expect(ids).toContain(DEFAULT_TRANSLATE_PRESET_ID);
    expect(ids).toContain(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids).toContain(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
    expect(ids).toContain(DEFAULT_ASK_PRESET_ID);
  });

  it("returns all 8 built-in presets when input is null", () => {
    const result = normalizeCorrectionSettings(null);
    expect(result.presets).toHaveLength(8);
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

  it("returns all 8 built-in presets when input is undefined", () => {
    const result = normalizeCorrectionSettings(undefined);
    expect(result.presets).toHaveLength(8);
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

  it("returns all 8 built-in presets when input is an empty object ({})", () => {
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

  it("includes all 8 built-in presets in order including business-writing, structured-text, ask and caveman at positions 4, 5, 6 and 7", () => {
    const result = normalizeCorrectionSettings({});
    const ids = result.presets.map((p) => p.id);
    expect(ids[0]).toBe("correction");
    expect(ids[1]).toBe("summarize");
    expect(ids[2]).toBe("prompt-optimization");
    expect(ids[3]).toBe(DEFAULT_TRANSLATE_PRESET_ID);
    expect(ids[4]).toBe(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids[5]).toBe(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
    expect(ids[6]).toBe(DEFAULT_ASK_PRESET_ID);
    expect(ids[7]).toBe(DEFAULT_CAVEMAN_PRESET_ID);
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

    expect(result.presets).toHaveLength(8);
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

  it("preserves custom presets, does not duplicate the new built-ins, and sorts customs after all eight built-ins", () => {
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
      DEFAULT_CAVEMAN_PRESET_ID,
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

  // The upgrade path unique to adding Caveman: `Control+Shift+C` was free
  // among the built-in defaults, the app bindings and the reserved combo-cancel
  // chord — but a user upgrading into this build may already have bound it to a
  // preset of their own. Built-in defaults are emitted ahead of custom presets
  // and `registerCorrectionShortcut` registers in array order, so a Caveman
  // materialized onto that chord would silently outrank the user's binding and
  // leave their preset unreachable with nothing logged.
  it("blanks Caveman when a stored custom preset already claims Control+Shift+C", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection, storedCustom("custom-c", "Control+Shift+C")],
      selectedPresetId: "correction",
    });

    expect(hotkeyOf(result, "custom-c")).toBe("Control+Shift+C");
    expect(hotkeyOf(result, DEFAULT_CAVEMAN_PRESET_ID)).toBe("");
  });

  it("still materializes Caveman itself when its hotkey is given up", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection, storedCustom("custom-c", "Control+Shift+C")],
      selectedPresetId: "correction",
    });

    const caveman = result.presets.find(
      (p) => p.id === DEFAULT_CAVEMAN_PRESET_ID,
    );

    expect(caveman).toBeDefined();
    expect(caveman?.isBuiltIn).toBe(true);
    expect(caveman?.systemPrompt).toBe(DEFAULT_CAVEMAN_PRESET_PROMPT);
    expect(caveman?.extraOptions).toEqual({ cavemanMode: "full" });
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
    // 8 built-ins + the one stored custom preset — blanking drops no preset.
    expect(result.presets).toHaveLength(9);
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

  it("leaves all eight defaults intact under the DEFAULT app bindings", () => {
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
      "Control+Shift+C",
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
 * B5 (design C6, closing V2): a default-sourced preset hotkey must give up
 * `Control+Escape` the same way it gives up a remapped `promptGen`/
 * `profileSwitch` above — the combo-cancel chord is statically reserved, not
 * conditional on any app binding actually landing on it. Unlike `promptGen`/
 * `profileSwitch`, this chord is not user-remappable, so
 * `readReservedAppAccelerators()` must carry it unconditionally rather than
 * behind the caller-supplied override used everywhere else in this file.
 *
 * No built-in default hotkey is `Control+Escape` today (all seven are
 * `Control+Shift+*`), so the effect is inert in practice — this only guards
 * against a future default ever moving onto that chord. The first test below
 * asserts the fix directly, since a real default landing on the reserved
 * accelerator (as every other case in this file proves through
 * `normalizeCorrectionSettings` itself) cannot happen with today's defaults.
 * The second test proves `normalizeCorrectionSettings` treats that constant
 * exactly like any other reserved entry once it is part of the set, mirroring
 * the mechanism already pinned above for `promptGen`/`profileSwitch`.
 */
describe("normalizeCorrectionSettings — B5: the combo-cancel chord is always reserved", () => {
  it("readReservedAppAccelerators() includes Control+Escape unconditionally, alongside promptGen/profileSwitch", () => {
    expect(readReservedAppAccelerators()).toContain(COMBO_CANCEL_ACCELERATOR);
  });

  it("blanks a materialized default whose hotkey sits on the combo-cancel chord, same mechanism as a remapped app binding", () => {
    // Reuses the exact "materialized default gives up a reserved app
    // accelerator" mechanism above, substituting COMBO_CANCEL_ACCELERATOR for
    // an app binding to prove `withoutReservedHotkey` treats it identically.
    const result = normalizeCorrectionSettings(
      { presets: [storedCorrection], selectedPresetId: "correction" },
      undefined,
      ["Control+Shift+B", COMBO_CANCEL_ACCELERATOR],
    );

    expect(hotkeyOf(result, DEFAULT_BUSINESS_WRITING_PRESET_ID)).toBe("");
    // Untouched defaults keep their hotkeys — the guard is targeted, not broad.
    expect(hotkeyOf(result, DEFAULT_STRUCTURED_TEXT_PRESET_ID)).toBe(
      "Control+Shift+R",
    );
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

// ---------------------------------------------------------------------------
// Tests: Combo sanitizer
// ---------------------------------------------------------------------------

const storedCombo = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "combo-1",
  name: "Polish and Translate",
  hotkey: "Control+Shift+K",
  steps: [
    { id: "s1", presetId: "correction" },
    { id: "s2", presetId: "translate" },
  ],
  ...overrides,
});

const combosOf = (settings: ReturnType<typeof normalizeCorrectionSettings>) =>
  settings.combos ?? [];

// The built-in "Perfect prompt" combo is materialized into every profile, so
// the sanitizer suites below — which are about what happens to STORED entries —
// filter it out. A test that asserts on the whole array would otherwise be
// asserting the default as well, and stop saying anything about the sanitizer.
const storedCombosOf = (
  settings: ReturnType<typeof normalizeCorrectionSettings>,
) =>
  combosOf(settings).filter(
    (combo) => combo.id !== DEFAULT_PERFECT_PROMPT_COMBO_ID,
  );

describe("normalizeCorrectionSettings — stored combos read as [] when absent or unusable", () => {
  it("contributes no stored combo when the settings carry no combos key", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
    });

    expect(storedCombosOf(result)).toEqual([]);
  });

  it("contributes no stored combo when the stored value is not an object at all", () => {
    expect(storedCombosOf(normalizeCorrectionSettings(undefined))).toEqual([]);
  });

  it("contributes no stored combo through the no-presets-array legacy path", () => {
    expect(
      storedCombosOf(normalizeCorrectionSettings({ userInput: "Legacy." })),
    ).toEqual([]);
  });

  it("contributes no stored combo when combos is not an array", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: { id: "combo-1" },
    });

    expect(storedCombosOf(result)).toEqual([]);
  });

  it("carries combos through the no-presets-array legacy path when present", () => {
    const result = normalizeCorrectionSettings({
      userInput: "Legacy.",
      combos: [storedCombo()],
    });

    expect(storedCombosOf(result).map((combo) => combo.id)).toEqual([
      "combo-1",
    ]);
  });
});

describe("normalizeCorrectionSettings — combo sanitizer drops malformed entries", () => {
  const combosFrom = (...combos: unknown[]) =>
    storedCombosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        combos,
      }),
    );

  it("keeps a well-formed combo verbatim", () => {
    expect(combosFrom(storedCombo())).toEqual([
      {
        id: "combo-1",
        name: "Polish and Translate",
        hotkey: "Control+Shift+K",
        steps: [
          { id: "s1", presetId: "correction" },
          { id: "s2", presetId: "translate" },
        ],
        schemaVersion: 1,
      },
    ]);
  });

  it("drops a non-object entry", () => {
    expect(combosFrom("nope", null, 7, storedCombo())).toHaveLength(1);
  });

  it("drops an entry with no id", () => {
    expect(combosFrom(storedCombo({ id: "   " }))).toEqual([]);
  });

  it("drops an entry with no name", () => {
    expect(combosFrom(storedCombo({ name: "" }))).toEqual([]);
  });

  it("drops an entry whose steps is not an array", () => {
    expect(combosFrom(storedCombo({ steps: "correction,translate" }))).toEqual(
      [],
    );
  });

  it("drops the WHOLE combo when any step is missing presetId", () => {
    // Dropping only the bad step would silently run a shorter chain than the
    // user configured — the change they would be least likely to notice.
    const result = combosFrom(
      storedCombo({
        steps: [{ id: "s1", presetId: "correction" }, { id: "s2" }],
      }),
    );

    expect(result).toEqual([]);
  });

  it("keeps an empty steps array — that is validateCombo's call, not the sanitizer's", () => {
    expect(combosFrom(storedCombo({ steps: [] }))[0].steps).toEqual([]);
  });

  it("drops a duplicate id, keeping the first", () => {
    const result = combosFrom(
      storedCombo({ name: "First" }),
      storedCombo({ name: "Second" }),
    );

    expect(result.map((combo) => combo.name)).toEqual(["First"]);
  });

  it("trims id, name and hotkey", () => {
    const result = combosFrom(
      storedCombo({
        id: "  c1  ",
        name: "  Polish  ",
        hotkey: "  Control+Shift+K  ",
      }),
    );

    expect(result[0]).toMatchObject({
      id: "c1",
      name: "Polish",
      hotkey: "Control+Shift+K",
    });
  });

  it("materializes a step id when one is missing", () => {
    const result = combosFrom(
      storedCombo({
        steps: [{ presetId: "correction" }, { presetId: "translate" }],
      }),
    );

    expect(result[0].steps.map((step) => step.id)).toEqual(["step-1", "step-2"]);
  });

  it("keeps inlineInput verbatim, whitespace included", () => {
    const result = combosFrom(
      storedCombo({
        steps: [
          { id: "s1", presetId: "ask", inlineInput: "  What changed?  " },
          { id: "s2", presetId: "correction" },
        ],
      }),
    );

    expect(result[0].steps[0].inlineInput).toBe("  What changed?  ");
  });

  it("drops a non-string inlineInput rather than stringifying it", () => {
    const result = combosFrom(
      storedCombo({
        steps: [
          { id: "s1", presetId: "ask", inlineInput: 42 },
          { id: "s2", presetId: "correction" },
        ],
      }),
    );

    expect(result[0].steps[0]).not.toHaveProperty("inlineInput");
  });
});

describe("normalizeCorrectionSettings — combo sanitizer keeps step ids unique within a combo", () => {
  const combosFrom = (...combos: unknown[]) =>
    storedCombosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        combos,
      }),
    );

  it("bumps a materialized id that collides with an earlier step's explicit id, keeping both steps", () => {
    // Step 0 explicitly claims "step-2"; step 1 has no id, and its index-based
    // materialization (`step-${index + 1}` -> "step-2") would collide with it.
    // A collision must not become a drop — the sanitizer keeps a missing id
    // recoverable, never fatal.
    const result = combosFrom(
      storedCombo({
        steps: [
          { id: "step-2", presetId: "correction" },
          { presetId: "correction" },
        ],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0].steps).toHaveLength(2);

    const ids = result[0].steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("step-2");
    expect(ids[1]).not.toBe("step-2");
  });

  it("bumps the second of two explicitly-duplicated step ids, keeping both steps", () => {
    const result = combosFrom(
      storedCombo({
        steps: [
          { id: "step-1", presetId: "correction" },
          { id: "step-1", presetId: "translate" },
        ],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0].steps).toHaveLength(2);

    const ids = result[0].steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("step-1");
    expect(ids[1]).not.toBe("step-1");
    // Each step keeps its own presetId — resolving the id collision must not
    // merge or reorder the steps themselves.
    expect(result[0].steps[0].presetId).toBe("correction");
    expect(result[0].steps[1].presetId).toBe("translate");
  });

  it("keeps three colliding materialized ids all distinct", () => {
    const result = combosFrom(
      storedCombo({
        steps: [
          { id: "step-2", presetId: "correction" },
          { presetId: "translate" },
          { presetId: "summarize" },
        ],
      }),
    );

    const ids = result[0].steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("normalizeCorrectionSettings — combo outputMode / markdownOutput / schemaVersion", () => {
  const comboFrom = (overrides: Record<string, unknown>) =>
    storedCombosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        combos: [storedCombo(overrides)],
      }),
    )[0];

  it.each(["inherit", "paste", "popup"] as const)(
    "keeps a recognized outputMode %s",
    (outputMode) => {
      expect(comboFrom({ outputMode }).outputMode).toBe(outputMode);
    },
  );

  it("drops an unrecognized outputMode instead of failing the combo", () => {
    const combo = comboFrom({ outputMode: "banana" });

    expect(combo).not.toHaveProperty("outputMode");
    expect(combo.id).toBe("combo-1");
  });

  it("keeps a boolean markdownOutput and drops a non-boolean one", () => {
    expect(comboFrom({ markdownOutput: true }).markdownOutput).toBe(true);
    expect(comboFrom({ markdownOutput: "yes" })).not.toHaveProperty(
      "markdownOutput",
    );
  });

  it("defaults schemaVersion to 1 when absent", () => {
    expect(comboFrom({}).schemaVersion).toBe(1);
  });

  it("normalizes an unrecognized schemaVersion to 1 rather than dropping the combo", () => {
    expect(comboFrom({ schemaVersion: "one" }).schemaVersion).toBe(1);
  });
});

/**
 * A combo's OWN hotkey is never rewritten — not onto a stored preset's chord,
 * not onto a reserved app binding, not onto the cancel chord. Every accelerator
 * in the app shares one registration space, and resolving a collision between
 * two things the user explicitly chose is the pre-save `validateHotkeys` gate's
 * job; a relinquish rule here would resolve a subset of that space differently
 * and without telling the user.
 *
 * The one asymmetry is the next describe: a built-in default hotkey being
 * MATERIALIZED was never chosen by anyone, so it yields.
 */
describe("normalizeCorrectionSettings — combo hotkeys pass through untouched", () => {
  const comboHotkeyWith = (
    hotkey: string,
    reservedAppAccelerators?: readonly string[],
  ) =>
    storedCombosOf(
      normalizeCorrectionSettings(
        {
          presets: [storedCorrection],
          selectedPresetId: "correction",
          combos: [storedCombo({ hotkey })],
        },
        undefined,
        reservedAppAccelerators,
      ),
    )[0].hotkey;

  it("keeps a free accelerator", () => {
    expect(comboHotkeyWith("Control+Shift+K")).toBe("Control+Shift+K");
  });

  it("keeps a hotkey a materialized built-in default also carries", () => {
    // The combo side of the asymmetry: the materialized default gives its
    // hotkey up (asserted in the next describe), the combo keeps its own.
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+B" })],
    });

    expect(storedCombosOf(result)[0].hotkey).toBe("Control+Shift+B");
  });

  it("keeps a hotkey a stored preset also claims", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection, storedCustom("mine", "Control+Shift+K")],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+K" })],
    });

    expect(hotkeyOf(result, "mine")).toBe("Control+Shift+K");
    expect(storedCombosOf(result)[0].hotkey).toBe("Control+Shift+K");
  });

  it("keeps a hotkey sitting on a reserved app accelerator", () => {
    expect(
      comboHotkeyWith("Control+Shift+P", ["Control+Shift+G", "Control+Shift+P"]),
    ).toBe("Control+Shift+P");
  });

  it("keeps a hotkey sitting on the combo-cancel chord", () => {
    expect(comboHotkeyWith(COMBO_CANCEL_ACCELERATOR)).toBe(
      COMBO_CANCEL_ACCELERATOR,
    );
  });

  it("leaves a combo with no hotkey field blank", () => {
    const stored = storedCombo();
    delete stored.hotkey;

    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [stored],
    });

    expect(storedCombosOf(result)[0].hotkey).toBe("");
  });

  it("leaves all eight preset defaults intact when the combo holds a free accelerator", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+K" })],
    });

    expect(result.presets.map((preset) => preset.hotkey)).toEqual([
      "Control+Shift+F",
      "Control+Shift+S",
      "Control+Shift+D",
      "Control+Shift+T",
      "Control+Shift+B",
      "Control+Shift+R",
      "Control+Shift+A",
      "Control+Shift+C",
    ]);
  });
});

/**
 * The other half of the anti-theft guard. The stored-PRESET half is asserted
 * far above; this is the stored-COMBO half, and the two exist for one reason:
 * `registerCorrectionShortcut` walks `presets` before `combos` through a single
 * `registeredShortcuts` set, so a preset materialized onto a chord a combo
 * holds wins the registration and the combo is dropped with nothing but a
 * `logger.warn`. The user then presses their own chord and gets one Caveman
 * transform on the profile's global default model — possibly a different
 * provider than the combo's steps resolved to — instead of their chain.
 *
 * `validateHotkeys` cannot catch it: it is renderer-only and runs at
 * capture/save, never against an already-stored profile. Every existing user
 * upgrading into the Caveman build materializes `Control+Shift+C` exactly once,
 * on next launch, with no save in sight.
 *
 * Scope is deliberately narrow, and the tests below pin both edges: only a
 * MATERIALIZED built-in yields. A stored preset's explicit hotkey and a combo's
 * own hotkey are both the user's choice and are never rewritten here.
 */
describe("normalizeCorrectionSettings — materialized built-in never steals a stored combo's hotkey", () => {
  it("blanks Caveman when a stored combo already claims Control+Shift+C", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+C" })],
    });

    expect(hotkeyOf(result, DEFAULT_CAVEMAN_PRESET_ID)).toBe("");
    expect(storedCombosOf(result)[0].hotkey).toBe("Control+Shift+C");
  });

  it("still materializes Caveman itself when its hotkey is given up to a combo", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+C" })],
    });

    const caveman = result.presets.find(
      (p) => p.id === DEFAULT_CAVEMAN_PRESET_ID,
    );

    expect(caveman).toBeDefined();
    expect(caveman?.isBuiltIn).toBe(true);
    expect(caveman?.systemPrompt).toBe(DEFAULT_CAVEMAN_PRESET_PROMPT);
    expect(caveman?.extraOptions).toEqual({ cavemanMode: "full" });
  });

  it("blanks only the colliding default, leaving the other seven alone", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+C" })],
    });

    expect(result.presets.map((preset) => preset.hotkey)).toEqual([
      "Control+Shift+F",
      "Control+Shift+S",
      "Control+Shift+D",
      "Control+Shift+T",
      "Control+Shift+B",
      "Control+Shift+R",
      "Control+Shift+A",
      "",
    ]);
  });

  it("blanks a hotkey INHERITED by a stored built-in that carries no hotkey field", () => {
    // The second materialization shape: the preset row is stored, but its
    // `hotkey` was injected by the `?? fallback?.hotkey` read. Not a claim, so
    // it yields the same way an absent preset does.
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection, { ...storedSummarize, hotkey: undefined }],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+S" })],
    });

    expect(hotkeyOf(result, "summarize")).toBe("");
    expect(storedCombosOf(result)[0].hotkey).toBe("Control+Shift+S");
  });

  it("yields through the no-presets-array legacy path too", () => {
    const result = normalizeCorrectionSettings({
      userInput: "Legacy.",
      combos: [storedCombo({ hotkey: "Control+Shift+C" })],
    });

    expect(hotkeyOf(result, DEFAULT_CAVEMAN_PRESET_ID)).toBe("");
    expect(storedCombosOf(result)[0].hotkey).toBe("Control+Shift+C");
  });

  it("does NOT rewrite a stored preset's hotkey that a combo also holds", () => {
    // The boundary: widening the claim set must not start resolving
    // stored-vs-stored collisions, which stay `validateHotkeys`' pre-save job.
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection, storedCustom("mine", "Control+Shift+C")],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+C" })],
    });

    expect(hotkeyOf(result, "mine")).toBe("Control+Shift+C");
    expect(storedCombosOf(result)[0].hotkey).toBe("Control+Shift+C");
    // Caveman was already yielding to the stored preset before combos joined
    // the claim set; adding the combo changes nothing about that.
    expect(hotkeyOf(result, DEFAULT_CAVEMAN_PRESET_ID)).toBe("");
  });

  it("treats a blank or whitespace-only combo hotkey as no claim", () => {
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [
        storedCombo({ id: "combo-blank", hotkey: "" }),
        storedCombo({ id: "combo-spaces", hotkey: "   " }),
      ],
    });

    expect(hotkeyOf(result, DEFAULT_CAVEMAN_PRESET_ID)).toBe("Control+Shift+C");
  });

  it("does not treat a DROPPED malformed combo's hotkey as a claim", () => {
    // A combo the sanitizer refuses never reaches `registerCorrectionShortcut`,
    // so it holds nothing and must not cost a built-in its default.
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+C", steps: "nope" })],
    });

    expect(hotkeyOf(result, DEFAULT_CAVEMAN_PRESET_ID)).toBe("Control+Shift+C");
  });

  it("is idempotent — normalizing the result again changes nothing", () => {
    const once = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedCombo({ hotkey: "Control+Shift+C" })],
    });
    const twice = normalizeCorrectionSettings(once);

    expect(twice).toEqual(once);
    expect(hotkeyOf(twice, DEFAULT_CAVEMAN_PRESET_ID)).toBe("");
  });
});

/**
 * Tripwires for two branches of the anti-theft guard that no behavioural test
 * can currently reach, because the built-in tables happen not to produce the
 * inputs that would reach them. Mutation testing found both: sabotage either
 * one and the whole suite stays green.
 *
 * Neither is a latent bug — the guard is written correctly. The problem is
 * that its correctness is currently unfalsifiable, so a future edit could
 * quietly undo it. Rather than add a test seam to production code for a case
 * nothing can reach, or fabricate a test whose input the app cannot actually
 * produce, these pin the PRECONDITIONS the untestable branches rest on. Each
 * goes red at exactly the moment its branch becomes reachable, which is the
 * moment a real test for it becomes writable — and lands that failure on the
 * person making that change, who is the one able to write it.
 */
describe("normalizeCorrectionSettings — preconditions the hotkey guard rests on", () => {
  it("ships no built-in default combo carrying a hotkey", () => {
    // `hotkeysClaimedByStoredCombos` is built from `storedCombos` (pre-merge)
    // rather than the `withDefaultCombos` output, so that a DEFAULT combo can
    // never blank a DEFAULT preset's hotkey — a stored-vs-materialized guard
    // must not fire materialized-vs-materialized. Mutating that source to the
    // merged `combos` list leaves every other test green, because the only
    // built-in combo ships `hotkey: ""` and the `length > 0` filter drops it,
    // making the two lists identical in every case the suite exercises.
    //
    // So this asserts the reason that mutation is currently harmless. Ship a
    // built-in combo with a real hotkey and this fails, which is the signal to
    // write the direct test that is finally possible at that point.
    const defaultCombos = getDefaultCorrectionSettings().combos;

    expect(defaultCombos.length).toBeGreaterThan(0);
    expect(
      defaultCombos.filter((combo) => combo.hotkey.trim().length > 0),
    ).toEqual([]);
  });

  it("ships only canonical built-in default preset hotkeys, needing no trim", () => {
    // The guard compares `preset.hotkey.trim()` against the claim set. The
    // combo side of that comparison is exercised (a whitespace-only combo
    // hotkey is no claim), but the PRESET side is not: dropping `.trim()`
    // there leaves the suite green.
    //
    // It cannot be exercised behaviourally today. The guard runs only on
    // default-sourced hotkeys — a stored hotkey is returned untouched — and
    // every hotkey in the defaults table is already canonical, whether it
    // arrives by materialization or by the `?? fallback?.hotkey` inheritance
    // read. There is no input to `normalizeCorrectionSettings` that reaches
    // that branch with whitespace, so a test feeding one would be asserting
    // against a state the app cannot produce.
    //
    // This pins the property that makes it unreachable instead. Add a default
    // hotkey with incidental whitespace and this fails, exposing that the
    // preset-side trim now matters and is unproven.
    const defaultHotkeys = getDefaultCorrectionSettings().presets.map(
      (preset) => preset.hotkey,
    );

    expect(defaultHotkeys.length).toBe(8);
    expect(defaultHotkeys).toEqual(defaultHotkeys.map((h) => h.trim()));
  });
});

describe("normalizeCorrectionSettings — the built-in Perfect prompt combo", () => {
  const comboFor = (stored?: unknown) =>
    combosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        ...(stored === undefined ? {} : { combos: stored }),
      }),
    ).find((combo) => combo.id === DEFAULT_PERFECT_PROMPT_COMBO_ID);

  it("materializes into a profile that predates combos entirely", () => {
    // The whole reason the merge exists: an existing profile stores
    // `combos: []`, which is a real value, so the store default never runs
    // against it and the combo would otherwise only reach fresh installs.
    expect(comboFor([])?.steps.map((step) => step.presetId)).toEqual([
      DEFAULT_CORRECTION_PRESET_ID,
      DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
      DEFAULT_CAVEMAN_PRESET_ID,
    ]);
  });

  it("keeps its id, name and empty hotkey while the step list moves", () => {
    // The resequencing is a change of STEPS only. The id is what
    // `withDefaultCombos` matches a stored entry on, the name is what the
    // Combos tab shows, and the empty hotkey is the deliberate no-accelerator
    // stance — none of the three may drift with the steps.
    const combo = comboFor([]);

    expect(combo?.id).toBe(DEFAULT_PERFECT_PROMPT_COMBO_ID);
    expect(combo?.name).toBe("Perfect prompt");
    expect(combo?.hotkey).toBe("");
  });

  it("ships with no hotkey, so it cannot outrank a binding the user already holds", () => {
    expect(comboFor()?.hotkey).toBe("");
  });

  it("leaves outputMode unset, inheriting the user's delivery choice", () => {
    expect(comboFor()?.outputMode).toBeUndefined();
  });

  it("yields to a stored combo on the same id, edits and all", () => {
    const edited = comboFor([
      {
        id: DEFAULT_PERFECT_PROMPT_COMBO_ID,
        name: "My prompt chain",
        hotkey: "Control+Shift+K",
        steps: [
          { id: "s1", presetId: "correction" },
          { id: "s2", presetId: "translate" },
        ],
        schemaVersion: 1,
      },
    ]);

    expect(edited?.name).toBe("My prompt chain");
    expect(edited?.hotkey).toBe("Control+Shift+K");
    expect(edited?.steps.map((step) => step.presetId)).toEqual([
      "correction",
      "translate",
    ]);
  });

  it("appears exactly once, and ahead of the user's own combos", () => {
    const ids = combosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        combos: [storedCombo(), storedCombo({ id: "combo-2", name: "Two" })],
      }),
    ).map((combo) => combo.id);

    expect(ids).toEqual([
      DEFAULT_PERFECT_PROMPT_COMBO_ID,
      "combo-1",
      "combo-2",
    ]);
  });

  it("references only preset ids that the built-in presets actually ship", () => {
    // A step pointing at a preset that does not exist is an `unknown-preset`
    // validation error, which blocks Save on a combo the user never touched.
    const presetIds = new Set(
      normalizeCorrectionSettings(undefined).presets.map((preset) => preset.id),
    );

    for (const step of comboFor()?.steps ?? []) {
      expect(presetIds.has(step.presetId)).toBe(true);
    }
  });

  it("has a step count validateCombo accepts", () => {
    const steps = comboFor()?.steps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(COMBO_MIN_STEPS);
    expect(steps.length).toBeLessThanOrEqual(COMBO_MAX_STEPS);
  });

  it("gives every step a distinct id", () => {
    const ids = (comboFor()?.steps ?? []).map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses no preset that would need an inline input", () => {
    // `requiresInput` presets (Ask AI) are invalid in a combo without stored
    // `inlineInput`, and a built-in cannot guess the user's question.
    const presetsById = new Map(
      normalizeCorrectionSettings(undefined).presets.map((preset) => [
        preset.id,
        preset,
      ]),
    );

    for (const step of comboFor()?.steps ?? []) {
      expect(presetsById.get(step.presetId)?.requiresInput ?? false).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: the signature-gated Perfect prompt resequencing upgrade
// ---------------------------------------------------------------------------

describe("normalizeCorrectionSettings — the Perfect prompt resequencing upgrade", () => {
  // The exact chain the built-in shipped with before the resequencing, step
  // ids included. Anything that is not THIS, in THIS order, is a chain the
  // user is responsible for and must survive a read untouched.
  const legacyTriple = () => [
    {
      id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-1`,
      presetId: DEFAULT_CORRECTION_PRESET_ID,
    },
    {
      id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-2`,
      presetId: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    },
    {
      id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-3`,
      presetId: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
    },
  ];

  const storedPerfectPrompt = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: DEFAULT_PERFECT_PROMPT_COMBO_ID,
    name: "Perfect prompt",
    hotkey: "",
    steps: legacyTriple(),
    schemaVersion: 1,
    ...overrides,
  });

  const readBack = (stored: Record<string, unknown>) =>
    combosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        combos: [stored],
      }),
    ).find((combo) => combo.id === DEFAULT_PERFECT_PROMPT_COMBO_ID);

  // -- Criterion 3: every other shape is left exactly as stored. ------------
  //
  // This is the whole risk of the card. The upgrade rewrites PERSISTED USER
  // DATA, so a matcher looser than the full ordered signature silently
  // replaces a chain the user built. Each case below is one step away from
  // the legacy triple in a different direction; a matcher that only counts
  // steps, or only looks at the first one, rewrites all three.
  const untouchedShapes: readonly (readonly [
    string,
    readonly Record<string, string>[],
  ])[] = [
    [
      "the legacy triple REORDERED",
      [legacyTriple()[1], legacyTriple()[0], legacyTriple()[2]],
    ],
    [
      "the legacy triple SHORTENED by one step",
      [legacyTriple()[0], legacyTriple()[2]],
    ],
    [
      "the legacy triple with ONE preset swapped",
      [
        legacyTriple()[0],
        { ...legacyTriple()[1], presetId: DEFAULT_SUMMARIZE_PRESET_ID },
        legacyTriple()[2],
      ],
    ],
  ];

  for (const [label, steps] of untouchedShapes) {
    it(`leaves ${label} byte-identical`, () => {
      const stored = storedPerfectPrompt({ steps: [...steps] });

      const readBackCombo = readBack(stored);

      expect(readBackCombo).toEqual({
        id: DEFAULT_PERFECT_PROMPT_COMBO_ID,
        name: "Perfect prompt",
        hotkey: "",
        steps: [...steps],
        schemaVersion: 1,
      });
      expect(JSON.stringify(readBackCombo?.steps)).toBe(JSON.stringify(steps));
    });
  }

  it("leaves the legacy triple alone once an extra step is appended", () => {
    const steps = [
      ...legacyTriple(),
      { id: "mine", presetId: DEFAULT_TRANSLATE_PRESET_ID },
    ];

    expect(readBack(storedPerfectPrompt({ steps }))?.steps).toEqual(steps);
  });

  it("leaves a legacy-shaped chain alone once a step carries an inline input", () => {
    // `inlineInput` is free text the model receives — the built-in never had
    // one, so its presence is by definition the user's own edit.
    const steps = legacyTriple().map((step, index) =>
      index === 1 ? { ...step, inlineInput: "Use bullet points." } : step,
    );

    expect(readBack(storedPerfectPrompt({ steps }))?.steps).toEqual(steps);
  });

  it("leaves the legacy triple alone when it is stored under another combo id", () => {
    const upgraded = combosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        combos: [
          storedPerfectPrompt({ id: "combo-1", name: "My own chain" }),
        ],
      }),
    ).find((combo) => combo.id === "combo-1");

    expect(upgraded?.steps).toEqual(legacyTriple());
  });

  // -- Criterion 2: the untouched legacy chain moves to the new sequence. ---

  it("upgrades a stored combo still sitting on the untouched legacy triple", () => {
    expect(
      readBack(storedPerfectPrompt())?.steps.map((step) => step.presetId),
    ).toEqual([
      DEFAULT_CORRECTION_PRESET_ID,
      DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
      DEFAULT_CAVEMAN_PRESET_ID,
    ]);
  });

  it("carries the stored name, hotkey, outputMode and markdownOutput through verbatim", () => {
    // Only the step list changes. A user may have renamed the row and bound a
    // chord to it; rewriting either would be the upgrade taking a decision the
    // user already made.
    const upgraded = readBack(
      storedPerfectPrompt({
        name: "My renamed chain",
        hotkey: "Control+Shift+K",
        outputMode: "popup",
        markdownOutput: true,
      }),
    );

    expect(upgraded).toEqual({
      id: DEFAULT_PERFECT_PROMPT_COMBO_ID,
      name: "My renamed chain",
      hotkey: "Control+Shift+K",
      outputMode: "popup",
      markdownOutput: true,
      steps: [
        {
          id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-1`,
          presetId: DEFAULT_CORRECTION_PRESET_ID,
        },
        {
          id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-2`,
          presetId: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
        },
        {
          id: `${DEFAULT_PERFECT_PROMPT_COMBO_ID}-step-3`,
          presetId: DEFAULT_CAVEMAN_PRESET_ID,
        },
      ],
      schemaVersion: 1,
    });
  });

  it("emits the same steps whether the combo was upgraded or materialized fresh", () => {
    const upgraded = readBack(storedPerfectPrompt());
    const materialized = combosOf(
      normalizeCorrectionSettings({
        presets: [storedCorrection],
        selectedPresetId: "correction",
        combos: [],
      }),
    ).find((combo) => combo.id === DEFAULT_PERFECT_PROMPT_COMBO_ID);

    expect(upgraded?.steps).toEqual(materialized?.steps);
  });

  it("does not let the upgraded combo's stored hotkey stop guarding the Caveman default", () => {
    // The `5fb449d` guard reads STORED combo hotkeys. The upgrade rewrites
    // steps only, so a stored chord must still blank the materialized
    // default that would otherwise outrank it.
    const result = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedPerfectPrompt({ hotkey: "Control+Shift+C" })],
    });

    expect(hotkeyOf(result, DEFAULT_CAVEMAN_PRESET_ID)).toBe("");
  });

  // -- Criterion 4: normalizing twice is a fixed point. ---------------------

  it("is a fixed point — normalizing the upgraded result again changes nothing", () => {
    const once = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [storedPerfectPrompt({ name: "Mine", hotkey: "Control+Shift+K" })],
    });
    const twice = normalizeCorrectionSettings(once);

    expect(twice).toEqual(once);
  });

  it("is a fixed point for an untouched other-shape chain too", () => {
    const stored = storedPerfectPrompt({
      steps: [legacyTriple()[1], legacyTriple()[0], legacyTriple()[2]],
    });
    const once = normalizeCorrectionSettings({
      presets: [storedCorrection],
      selectedPresetId: "correction",
      combos: [stored],
    });
    const twice = normalizeCorrectionSettings(once);

    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// Tests: extraOptions stays absent from every existing built-in
// ---------------------------------------------------------------------------

describe("normalizeCorrectionSettings — no built-in but Caveman emits an extraOptions key", () => {
  // `extraOptions` is opt-in per preset, declared in the option registry. None
  // of the seven presets that shipped before it declares an option, so the key
  // must be ABSENT rather than `{}` or `undefined`: an emitted key would widen
  // every stored preset row, move the profile-export bytes, and make a preset
  // that has no options indistinguishable from one whose options were all
  // dropped as invalid. Caveman is the one built-in that DOES declare an
  // option, so it is held to the opposite assertion below.
  const OPTIONLESS_BUILT_IN_IDS = [
    "correction",
    "summarize",
    "prompt-optimization",
    DEFAULT_TRANSLATE_PRESET_ID,
    DEFAULT_BUSINESS_WRITING_PRESET_ID,
    DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    DEFAULT_ASK_PRESET_ID,
  ];

  const ALL_BUILT_IN_IDS = [
    ...OPTIONLESS_BUILT_IN_IDS,
    DEFAULT_CAVEMAN_PRESET_ID,
  ];

  it("getDefaultCorrectionSettings emits no extraOptions on any optionless built-in", () => {
    for (const preset of getDefaultCorrectionSettings().presets) {
      if (preset.id === DEFAULT_CAVEMAN_PRESET_ID) continue;
      expect(preset).not.toHaveProperty("extraOptions");
    }
  });

  it("a fresh normalize emits no extraOptions on any optionless built-in", () => {
    const normalized = normalizeCorrectionSettings(undefined);

    expect(normalized.presets.map((preset) => preset.id)).toEqual(
      ALL_BUILT_IN_IDS,
    );
    for (const preset of normalized.presets) {
      if (preset.id === DEFAULT_CAVEMAN_PRESET_ID) continue;
      expect(preset).not.toHaveProperty("extraOptions");
    }
  });

  it("carries Caveman's declared option through a fresh normalize", () => {
    const normalized = normalizeCorrectionSettings(undefined);
    const caveman = normalized.presets.find(
      (preset) => preset.id === DEFAULT_CAVEMAN_PRESET_ID,
    );

    expect(caveman?.extraOptions).toEqual({ cavemanMode: "full" });
  });

  it("keeps a stored Caveman intensity the user chose", () => {
    const normalized = normalizeCorrectionSettings({
      presets: [
        {
          id: DEFAULT_CAVEMAN_PRESET_ID,
          name: "Caveman",
          hotkey: "Control+Shift+C",
          systemPrompt: "stored prompt",
          model: "",
          isBuiltIn: true,
          extraOptions: { cavemanMode: "ultra" },
        },
      ],
      selectedPresetId: DEFAULT_CAVEMAN_PRESET_ID,
    });
    const caveman = normalized.presets.find(
      (preset) => preset.id === DEFAULT_CAVEMAN_PRESET_ID,
    );

    expect(caveman?.extraOptions).toEqual({ cavemanMode: "ultra" });
  });

  it("drops an extraOptions blob stored against a built-in that declares none", () => {
    const normalized = normalizeCorrectionSettings({
      presets: OPTIONLESS_BUILT_IN_IDS.map((id) => ({
        id,
        name: id,
        hotkey: "",
        systemPrompt: "stored prompt",
        model: "",
        isBuiltIn: true,
        extraOptions: { cavemanMode: "ultra", anything: "at all" },
      })),
      selectedPresetId: "correction",
    });

    for (const preset of normalized.presets) {
      if (preset.id === DEFAULT_CAVEMAN_PRESET_ID) continue;
      expect(preset).not.toHaveProperty("extraOptions");
    }
  });

  it("drops a non-object extraOptions on a custom preset too", () => {
    const normalized = normalizeCorrectionSettings({
      presets: [
        {
          id: "my-custom",
          name: "Custom",
          hotkey: "",
          systemPrompt: "stored prompt",
          model: "",
          isBuiltIn: false,
          extraOptions: "cavemanMode=ultra",
        },
      ],
      selectedPresetId: "my-custom",
    });

    const custom = normalized.presets.find((preset) => preset.id === "my-custom");
    expect(custom).toBeDefined();
    expect(custom).not.toHaveProperty("extraOptions");
  });
});
