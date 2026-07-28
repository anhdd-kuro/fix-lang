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

describe("getDefaultCorrectionSettings — returns 6 built-in presets including Business Writing and Structured Text", () => {
  it("returns exactly 6 presets", () => {
    const defaults = getDefaultCorrectionSettings();
    expect(defaults.presets).toHaveLength(6);
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

  it("includes correction, summarize, prompt-optimization, translate, business-writing, structured-text in order", () => {
    const defaults = getDefaultCorrectionSettings();
    const ids = defaults.presets.map((p) => p.id);

    expect(ids).toEqual([
      "correction",
      "summarize",
      "prompt-optimization",
      "translate",
      DEFAULT_BUSINESS_WRITING_PRESET_ID,
      DEFAULT_STRUCTURED_TEXT_PRESET_ID,
    ]);
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
    expect(businessWriting).not.toHaveProperty("temperature");
    expect(businessWriting).not.toHaveProperty("maxTokens");
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
    expect(structuredText).not.toHaveProperty("temperature");
    expect(structuredText).not.toHaveProperty("maxTokens");
  });

  it("keeps Business Writing and Structured Text hotkeys distinct from every other default and app hotkey", () => {
    const defaults = getDefaultCorrectionSettings();
    const hotkeys = defaults.presets.map((p) => p.hotkey);

    // No two default presets may share an accelerator.
    expect(new Set(hotkeys).size).toBe(hotkeys.length);
    expect(hotkeys).toContain("Control+Shift+B");
    expect(hotkeys).toContain("Control+Shift+R");
    // Distinct from the static app hotkeys (promptGen/profileSwitch) and devtools.
    expect(hotkeys).not.toContain("Control+Shift+G");
    expect(hotkeys).not.toContain("Control+Shift+P");
    expect(hotkeys).not.toContain("F12");
  });
});

describe("normalizeCorrectionSettings — legacy path (no presets array)", () => {
  it("returns all 6 built-in presets when input has no presets array", () => {
    // Simulates a very old profile that predates the preset system (no presets key at all)
    const result = normalizeCorrectionSettings({});
    expect(result.presets).toHaveLength(6);
    const ids = result.presets.map((p) => p.id);
    expect(ids).toContain("correction");
    expect(ids).toContain("summarize");
    expect(ids).toContain("prompt-optimization");
    expect(ids).toContain(DEFAULT_TRANSLATE_PRESET_ID);
    expect(ids).toContain(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids).toContain(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
  });

  it("returns all 6 built-in presets when input is null", () => {
    const result = normalizeCorrectionSettings(null);
    expect(result.presets).toHaveLength(6);
    expect(result.presets.find((p) => p.id === DEFAULT_TRANSLATE_PRESET_ID)).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID),
    ).toBeDefined();
  });

  it("returns all 6 built-in presets when input is undefined", () => {
    const result = normalizeCorrectionSettings(undefined);
    expect(result.presets).toHaveLength(6);
    expect(result.presets.find((p) => p.id === DEFAULT_TRANSLATE_PRESET_ID)).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_BUSINESS_WRITING_PRESET_ID),
    ).toBeDefined();
    expect(
      result.presets.find((p) => p.id === DEFAULT_STRUCTURED_TEXT_PRESET_ID),
    ).toBeDefined();
  });

  it("returns all 6 built-in presets when input is an empty object ({})", () => {
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
    const result = normalizeCorrectionSettings({ userInput: "Custom prompt text" });
    const correctionPreset = result.presets.find((p) => p.id === "correction");
    expect(correctionPreset?.systemPrompt).toContain("Custom prompt text");
  });

  it("includes all 6 built-in presets in order including business-writing and structured-text at positions 4 and 5", () => {
    const result = normalizeCorrectionSettings({});
    const ids = result.presets.map((p) => p.id);
    expect(ids[0]).toBe("correction");
    expect(ids[1]).toBe("summarize");
    expect(ids[2]).toBe("prompt-optimization");
    expect(ids[3]).toBe(DEFAULT_TRANSLATE_PRESET_ID);
    expect(ids[4]).toBe(DEFAULT_BUSINESS_WRITING_PRESET_ID);
    expect(ids[5]).toBe(DEFAULT_STRUCTURED_TEXT_PRESET_ID);
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

    expect(result.presets).toHaveLength(6);
  });

  it("preserves custom presets, does not duplicate the new built-ins, and sorts customs after all six built-ins", () => {
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
          temperature: 0.4,
          maxTokens: 2048,
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
      temperature: 0.4,
      maxTokens: 2048,
    });
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
          temperature: 0.2,
          maxTokens: 4096,
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
      temperature: 0.2,
      maxTokens: 4096,
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
    expect(translate?.systemPrompt).toContain(DEFAULT_TRANSLATE_PRESET_PROMPT.trim());
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
    expect(translate?.systemPrompt).toBe(DEFAULT_TRANSLATE_PRESET_PROMPT.trim());
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

const storedCustom = (
  id: string,
  hotkey: string,
): Record<string, unknown> => ({
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
    expect(translate?.systemPrompt).toBe(DEFAULT_TRANSLATE_PRESET_PROMPT.trim());
    // 6 built-ins + the one stored custom preset — blanking drops no preset.
    expect(result.presets).toHaveLength(7);
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
