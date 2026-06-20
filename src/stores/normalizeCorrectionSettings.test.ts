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
