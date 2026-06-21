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
  DEFAULT_TRANSLATE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_PROMPT,
} from "~/prompts/correction";
import {
  normalizeCorrectionSettings,
  getDefaultCorrectionSettings,
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

describe("getDefaultCorrectionSettings — returns 4 built-in presets including Translate", () => {
  it("returns exactly 4 presets", () => {
    const defaults = getDefaultCorrectionSettings();
    expect(defaults.presets).toHaveLength(4);
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

  it("includes correction, summarize, prompt-optimization, translate in order", () => {
    const defaults = getDefaultCorrectionSettings();
    const ids = defaults.presets.map((p) => p.id);

    expect(ids).toEqual([
      "correction",
      "summarize",
      "prompt-optimization",
      "translate",
    ]);
  });
});

describe("normalizeCorrectionSettings — legacy path (no presets array)", () => {
  it("returns all 4 built-in presets when input has no presets array", () => {
    // Simulates a very old profile that predates the preset system (no presets key at all)
    const result = normalizeCorrectionSettings({});
    expect(result.presets).toHaveLength(4);
    const ids = result.presets.map((p) => p.id);
    expect(ids).toContain("correction");
    expect(ids).toContain("summarize");
    expect(ids).toContain("prompt-optimization");
    expect(ids).toContain(DEFAULT_TRANSLATE_PRESET_ID);
  });

  it("returns all 4 built-in presets when input is null", () => {
    const result = normalizeCorrectionSettings(null);
    expect(result.presets).toHaveLength(4);
    expect(result.presets.find((p) => p.id === DEFAULT_TRANSLATE_PRESET_ID)).toBeDefined();
  });

  it("returns all 4 built-in presets when input is undefined", () => {
    const result = normalizeCorrectionSettings(undefined);
    expect(result.presets).toHaveLength(4);
    expect(result.presets.find((p) => p.id === DEFAULT_TRANSLATE_PRESET_ID)).toBeDefined();
  });

  it("migrates legacy userInput into correction preset systemPrompt", () => {
    // Old-style stored object with userInput but no presets
    const result = normalizeCorrectionSettings({ userInput: "Custom prompt text" });
    const correctionPreset = result.presets.find((p) => p.id === "correction");
    expect(correctionPreset?.systemPrompt).toContain("Custom prompt text");
  });

  it("includes all 4 built-in presets in order including translate at position 3", () => {
    const result = normalizeCorrectionSettings({});
    const ids = result.presets.map((p) => p.id);
    expect(ids[0]).toBe("correction");
    expect(ids[1]).toBe("summarize");
    expect(ids[2]).toBe("prompt-optimization");
    expect(ids[3]).toBe(DEFAULT_TRANSLATE_PRESET_ID);
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
});
