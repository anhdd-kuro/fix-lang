/**
 * @file correction-preset-options.test.ts
 * @description Tests for per-preset temperature/maxTokens flowing through the AI request path.
 * Pure unit tests — no Electron, no IPC, no network.
 */
// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mock electron-store to avoid "projectName" initialization error in test env.
// Must be a proper ES module default export of a class/constructor.
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
  Notification: class {
    show = vi.fn();
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));
vi.mock("~/stores/apiStore", async (importOriginal) => {
  // We want the real normalizeCorrectionSettings for the normalize tests,
  // but mock getProfileSetting so fixGrammar tests work independently.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.importActual returns unknown module shape
  const real = await importOriginal<any>();
  return {
    ...real,
    // Override only getProfileSetting; keep normalizeCorrectionSettings real
    getProfileSetting: vi.fn(),
    // apiStore mock (prevent electron-store calls)
    apiStore: {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    },
  };
});
vi.mock("./shared", () => ({
  makeAIRequest: vi.fn(),
  getActiveProvider: vi.fn().mockReturnValue("openrouter"),
}));
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { getProfileSetting, normalizeCorrectionSettings } from "~/stores/apiStore";
import { estimateTextTokens } from "~/stores/historyStore";
import { fixGrammar } from "./correction";
import { getActiveProvider, makeAIRequest } from "./shared";
import type { Mock } from "vitest";
import type { CorrectionPreset, CorrectionSettings } from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePreset = (overrides: Partial<CorrectionPreset> = {}): CorrectionPreset => ({
  id: "test-preset-1",
  name: "Test Preset",
  hotkey: "Control+Shift+T",
  systemPrompt: "Fix grammar.",
  model: "openai/gpt-4o",
  isBuiltIn: false,
  ...overrides,
});

const makeSettings = (preset: CorrectionPreset): CorrectionSettings => ({
  presets: [preset],
  selectedPresetId: preset.id,
});

const setupMockSettings = (preset: CorrectionPreset) => {
  (getProfileSetting as Mock).mockReturnValue(makeSettings(preset));
  (makeAIRequest as Mock).mockResolvedValue({
    content: ["Fixed text"],
    promptTokens: 10,
    completionTokens: 20,
    model: preset.model,
  });
};

// ---------------------------------------------------------------------------
// Tests: fixGrammar passes preset temperature/maxTokens to makeAIRequest
// ---------------------------------------------------------------------------

describe("fixGrammar — per-preset temperature and maxTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes preset temperature to makeAIRequest", async () => {
    const preset = makePreset({ temperature: 0.3 });
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(call.temperature).toBe(0.3);
  });

  it("passes preset maxTokens to makeAIRequest", async () => {
    const preset = makePreset({ maxTokens: 5000 });
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(call.maxTokens).toBe(5000);
  });

  it("passes undefined temperature when preset has none", async () => {
    const preset = makePreset();
    // no temperature property on preset
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(call.temperature).toBeUndefined();
  });

  it("passes undefined maxTokens when preset has none", async () => {
    const preset = makePreset();
    // no maxTokens property on preset
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(call.maxTokens).toBeUndefined();
  });

  it("does NOT pass skipGlobalSettings to makeAIRequest", async () => {
    const preset = makePreset({ temperature: 0.5 });
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(Object.keys(call)).not.toContain("skipGlobalSettings");
  });

  it("passes both temperature and maxTokens when preset has both", async () => {
    const preset = makePreset({ temperature: 0.7, maxTokens: 8000 });
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(call.temperature).toBe(0.7);
    expect(call.maxTokens).toBe(8000);
  });

  it("falls back to input and output text token estimates when usage is missing", async () => {
    const preset = makePreset();
    (getProfileSetting as Mock).mockReturnValue(makeSettings(preset));
    (makeAIRequest as Mock).mockResolvedValue({
      content: ["Fixed text"],
      promptTokens: null,
      completionTokens: null,
      model: preset.model,
    });

    const result = await fixGrammar("hello world");

    expect(result.promptTokens).toBe(estimateTextTokens("hello world"));
    expect(result.completionTokens).toBe(estimateTextTokens("Fixed text"));
  });
});

// ---------------------------------------------------------------------------
// Tests: fixGrammar empty-input early return reports the real active
// provider (L1 fix) instead of a hardcoded "openrouter".
// ---------------------------------------------------------------------------

describe("fixGrammar — empty input early return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const preset = makePreset();
    (getProfileSetting as Mock).mockReturnValue(makeSettings(preset));
  });

  it("reports the active provider instead of a hardcoded value", async () => {
    (getActiveProvider as Mock).mockReturnValue("openai");

    const result = await fixGrammar("   ");

    expect(result.provider).toBe("openai");
    expect(makeAIRequest).not.toHaveBeenCalled();
  });

  it("reflects a different active provider (ollama) too", async () => {
    (getActiveProvider as Mock).mockReturnValue("ollama");

    const result = await fixGrammar("");

    expect(result.provider).toBe("ollama");
  });
});

// ---------------------------------------------------------------------------
// Tests: normalizeCorrectionSettings temperature/maxTokens handling
// We call normalizeCorrectionSettings from the (partially real) mock.
// The real implementation is used since we spread ...real in the mock factory.
// ---------------------------------------------------------------------------

describe("normalizeCorrectionSettings — temperature and maxTokens fields", () => {
  it("preserves numeric temperature on a stored preset", () => {
    const stored = {
      presets: [
        {
          id: "correction-default",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4o",
          isBuiltIn: true,
          temperature: 0.5,
        },
      ],
      selectedPresetId: "correction-default",
    };

    const result = normalizeCorrectionSettings(stored);
    const preset = result.presets.find((p) => p.id === "correction-default");
    expect(preset?.temperature).toBe(0.5);
  });

  it("drops non-numeric temperature from stored preset", () => {
    const stored = {
      presets: [
        {
          id: "correction-default",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4o",
          isBuiltIn: true,
          temperature: "foo",
        },
      ],
      selectedPresetId: "correction-default",
    };

    const result = normalizeCorrectionSettings(stored);
    const preset = result.presets.find((p) => p.id === "correction-default");
    expect(preset?.temperature).toBeUndefined();
  });

  it("loads a preset that still has applyGlobalPromptSettings without error", () => {
    const stored = {
      presets: [
        {
          id: "correction-default",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4o",
          isBuiltIn: true,
          applyGlobalPromptSettings: true,
        },
      ],
      selectedPresetId: "correction-default",
    };

    expect(() => normalizeCorrectionSettings(stored)).not.toThrow();
    const result = normalizeCorrectionSettings(stored);
    const preset = result.presets.find((p) => p.id === "correction-default");
    // After migration, applyGlobalPromptSettings should NOT be on the preset
    expect(preset).not.toHaveProperty("applyGlobalPromptSettings");
  });

  it("preserves numeric maxTokens on a stored preset", () => {
    const stored = {
      presets: [
        {
          id: "correction-default",
          name: "Correction",
          hotkey: "Control+Shift+F",
          systemPrompt: "Fix grammar.",
          model: "openai/gpt-4o",
          isBuiltIn: true,
          maxTokens: 5000,
        },
      ],
      selectedPresetId: "correction-default",
    };

    const result = normalizeCorrectionSettings(stored);
    const preset = result.presets.find((p) => p.id === "correction-default");
    expect(preset?.maxTokens).toBe(5000);
  });
});
