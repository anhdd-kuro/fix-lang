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
    // Mocked too: the real one reads the live profile through electron-store.
    // The empty-text early return derives its whole reported identity from
    // this, so the tests below drive it directly.
    getDefaultModelId: vi.fn().mockReturnValue(""),
    // apiStore mock (prevent electron-store calls)
    apiStore: {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    },
  };
});
// `getActiveProvider` is deliberately ABSENT from this mock. Card 04 deleted
// it from `./shared`; mocking a function the codebase no longer exports would
// re-create the stub in test-space and assert behaviour production cannot
// produce. The empty-text tests below drive the real ref-parsing path instead.
vi.mock("./shared", () => ({
  makeAIRequest: vi.fn(),
}));
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import {
  getDefaultModelId,
  getProfileSetting,
  normalizeCorrectionSettings,
} from "~/stores/apiStore";
import { estimateTextTokens } from "~/stores/historyStore";
import { fixGrammar } from "./correction";
import { makeAIRequest } from "./shared";
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
// Tests: fixGrammar empty-input early return.
//
// This block replaces two tests that mocked `getActiveProvider` and asserted
// the mock's own return value ("reports the active provider instead of a
// hardcoded value" / "reflects a different active provider (ollama) too").
// That function no longer exists — the branch now reports the provider named
// by the composite model ref it would have requested, so the tests are
// rewritten against that, not re-pointed at a replacement stub.
// ---------------------------------------------------------------------------

describe("fixGrammar — empty input early return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getProfileSetting as Mock).mockReturnValue(makeSettings(makePreset()));
    (getDefaultModelId as Mock).mockReturnValue("");
  });

  const withPresetModel = (model: string) => {
    (getProfileSetting as Mock).mockReturnValue(makeSettings(makePreset({ model })));
  };

  it("reports the provider named by the preset's model ref", async () => {
    withPresetModel("openai::gpt-4o");

    const result = await fixGrammar("   ");

    expect(result.provider).toBe("openai");
    expect(makeAIRequest).not.toHaveBeenCalled();
  });

  it("reports a different provider when the ref names one — ollama", async () => {
    withPresetModel("ollama::llama3.2:3b");

    const result = await fixGrammar("");

    expect(result.provider).toBe("ollama");
  });

  it("reports the RAW model id, never the composite ref", async () => {
    // Matches `makeAIRequest`'s contract: `model` / `resolvedModel` stay raw
    // so history rows need no migration. The tag's own ":" must survive — the
    // ref splits on the FIRST "::" only.
    withPresetModel("ollama::llama3.2:3b");

    const result = await fixGrammar("");

    expect(result.model).toBe("llama3.2:3b");
    expect(result.resolvedModel).toBe("llama3.2:3b");
  });

  it("falls back to the inherited global default when the preset inherits", async () => {
    withPresetModel("");
    (getDefaultModelId as Mock).mockReturnValue("openrouter::openai/gpt-4o");

    const result = await fixGrammar("");

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("openai/gpt-4o");
  });

  it("invents nothing when getDefaultModelId() is the inherit sentinel", async () => {
    // The acceptance criterion: no `getActiveProvider`, no
    // `DEFAULT_OPENAI_MODEL`. With nothing to report the branch must report
    // nothing rather than name a provider the user never chose.
    withPresetModel("");
    (getDefaultModelId as Mock).mockReturnValue("");

    const result = await fixGrammar("   ");

    expect(result.provider).toBeUndefined();
    expect(result.model).toBe("");
    expect(result.resolvedModel).toBe("");
    expect(makeAIRequest).not.toHaveBeenCalled();
  });

  it("reports no provider for a bare (un-migrated) model id", async () => {
    // A bare id names no provider, and this branch has no model cache to
    // resolve it against. Guessing one is exactly the anti-pattern the
    // refactor removes, so `provider` stays undefined while `model` is still
    // reported truthfully.
    withPresetModel("gpt-4o");

    const result = await fixGrammar("");

    expect(result.provider).toBeUndefined();
    expect(result.model).toBe("gpt-4o");
  });

  it("still returns the preset identity and zeroed usage", async () => {
    withPresetModel("openai::gpt-4o");

    const result = await fixGrammar("  \n ");

    expect(result).toMatchObject({
      correctedText: "  \n ",
      promptTokens: 0,
      completionTokens: 0,
      presetId: "test-preset-1",
      presetName: "Test Preset",
    });
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
