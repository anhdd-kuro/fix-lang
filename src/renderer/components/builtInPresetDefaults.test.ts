/**
 * @file builtInPresetDefaults.test.ts
 * @description Unit tests for `SettingCorrection.tsx`'s `makeBuiltInPresetDefaults`
 * — the Settings sidebar's per-id "reset built-in" map. Pure function import
 * only; no rendering (no React Testing Library, no react-dom). Importing
 * `getDefaultCorrectionSettings` pulls in `~/features/providers/store/apiStore`, which touches
 * electron-store / electron at module scope, hence the two mocks below
 * (hoisted by Vitest).
 */
import { describe, expect, it, vi } from "vitest";
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
import { getDefaultCorrectionSettings } from "~/features/providers/store/apiStore";
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_PRESET_PROMPT,
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_ID,
} from "~/prompts/correction";
import { makeBuiltInPresetDefaults } from "./SettingCorrection";

describe("makeBuiltInPresetDefaults — the Settings sidebar's built-in reset map", () => {
  it("resolves both new built-in ids", () => {
    const defaults = makeBuiltInPresetDefaults();

    expect(defaults[DEFAULT_BUSINESS_WRITING_PRESET_ID]).toBeDefined();
    expect(defaults[DEFAULT_STRUCTURED_TEXT_PRESET_ID]).toBeDefined();
  });

  it("resolves all eight built-in ids", () => {
    const defaults = makeBuiltInPresetDefaults();
    const ids = Object.keys(defaults);

    expect(ids).toHaveLength(8);
    expect(ids).toEqual(
      expect.arrayContaining([
        DEFAULT_CORRECTION_PRESET_ID,
        DEFAULT_SUMMARIZE_PRESET_ID,
        DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
        DEFAULT_TRANSLATE_PRESET_ID,
        DEFAULT_BUSINESS_WRITING_PRESET_ID,
        DEFAULT_STRUCTURED_TEXT_PRESET_ID,
        DEFAULT_ASK_PRESET_ID,
        DEFAULT_CAVEMAN_PRESET_ID,
      ]),
    );
  });

  it("every entry's id property equals its own map key", () => {
    const defaults = makeBuiltInPresetDefaults();

    for (const [key, preset] of Object.entries(defaults)) {
      expect(preset.id).toBe(key);
    }
  });

  // The apiStore factory (`makeDefaultCorrectionPresets` via
  // `getDefaultCorrectionSettings`) and this component-level map must never
  // drift apart field-for-field — this is what keeps "Reset built-in" in
  // Settings consistent with what a fresh profile/reset actually gets.
  //
  // This case proves the two factories AGREE, not that either is CORRECT: an
  // identical mutation applied to both would still pass here. Correctness is
  // held by the hardcoded-literal cases below and by their counterparts in
  // `normalizeCorrectionSettings.test.ts`. Do not delete those on the belief
  // that this comparison covers them — it does not.
  it("matches the store factory field-for-field for every built-in preset", () => {
    const uiDefaults = makeBuiltInPresetDefaults();
    const storeDefaults = getDefaultCorrectionSettings().presets;

    expect(storeDefaults.length).toBeGreaterThan(0);
    for (const storePreset of storeDefaults) {
      expect(uiDefaults[storePreset.id]).toEqual(storePreset);
    }
  });

  it("Prompt optimization defaults to Low reasoning", () => {
    const preset =
      makeBuiltInPresetDefaults()[DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID];

    expect(preset.reasoning).toBe("low");
  });

  it("Business Writing matches the exact field values (name/hotkey/model/isBuiltIn, Low reasoning)", () => {
    const preset =
      makeBuiltInPresetDefaults()[DEFAULT_BUSINESS_WRITING_PRESET_ID];

    expect(preset.name).toBe("Business Writing");
    expect(preset.hotkey).toBe("Control+Shift+B");
    expect(preset.model).toBe("");
    expect(preset.isBuiltIn).toBe(true);
    expect(preset.reasoning).toBe("low");
  });

  it("Caveman matches the exact field values (name/hotkey/prompt/model/isBuiltIn/extraOptions, no reasoning)", () => {
    const preset = makeBuiltInPresetDefaults()[DEFAULT_CAVEMAN_PRESET_ID];

    expect(preset.name).toBe("Caveman");
    expect(preset.hotkey).toBe("Control+Shift+C");
    expect(preset.systemPrompt).toBe(DEFAULT_CAVEMAN_PRESET_PROMPT);
    expect(preset.model).toBe("");
    expect(preset.isBuiltIn).toBe(true);
    expect(preset.extraOptions).toEqual({ cavemanMode: "full" });
    expect(preset).not.toHaveProperty("reasoning");
    expect(preset).not.toHaveProperty("requiresInput");
    expect(preset).not.toHaveProperty("outputMode");
    expect(preset).not.toHaveProperty("markdownOutput");
  });

  it("Context-Aware Structured Text matches the exact field values (name/hotkey/model/isBuiltIn, no reasoning)", () => {
    const preset =
      makeBuiltInPresetDefaults()[DEFAULT_STRUCTURED_TEXT_PRESET_ID];

    expect(preset.name).toBe("Context-Aware Structured Text");
    expect(preset.hotkey).toBe("Control+Shift+R");
    expect(preset.model).toBe("");
    expect(preset.isBuiltIn).toBe(true);
    expect(preset).not.toHaveProperty("reasoning");
  });
});
