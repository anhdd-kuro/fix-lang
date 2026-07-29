/**
 * @file correction-preset-options.test.ts
 * @description Tests for per-preset reasoning effort flowing through the AI request path.
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
    getDefaultModelId: vi.fn().mockReturnValue(""),
    // apiStore mock (prevent electron-store calls)
    apiStore: {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    },
  };
});
vi.mock("./shared", () => ({
  makeAIRequest: vi.fn(),
}));
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID } from "~/prompts";
import {
  getDefaultModelId,
  getProfileSetting,
  normalizeCorrectionSettings,
} from "~/stores/apiStore";
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
// Tests: fixGrammar passes preset reasoning to makeAIRequest
// ---------------------------------------------------------------------------

describe("fixGrammar — per-preset reasoning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes preset reasoning to makeAIRequest", async () => {
    const preset = makePreset({ reasoning: "high" });
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(call.reasoning).toBe("high");
  });

  it("passes the global default reasoning when preset has none", async () => {
    const preset = makePreset();
    setupMockSettings(preset);

    await fixGrammar("hello world");

    const call = (makeAIRequest as Mock).mock.calls[0][0];
    expect(call.reasoning).toBe("none");
  });
});


describe("fixGrammar — prompt-optimization target model id", () => {
  const PROMPT_OPTIMIZATION_REF = "openrouter::google/gemma-2-9b-it";
  const PROMPT_OPTIMIZATION_RAW_ID = "google/gemma-2-9b-it";

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockSettings(
      makePreset({
        id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
        model: PROMPT_OPTIMIZATION_REF,
      }),
    );
  });

  it("names the RAW model id in the user prompt, never the composite ref", async () => {
    await fixGrammar("draft prompt");

    const { userPrompt } = (makeAIRequest as Mock).mock.calls[0][0];
    expect(userPrompt).toContain(
      `- The selected target model ID is: ${PROMPT_OPTIMIZATION_RAW_ID}.`,
    );
    expect(userPrompt).not.toContain("openrouter::");
  });

  it("still routes on the composite ref", async () => {
    await fixGrammar("draft prompt");

    const { model } = (makeAIRequest as Mock).mock.calls[0][0];
    expect(model).toBe(PROMPT_OPTIMIZATION_REF);
  });

  it("names the inherited default's raw id when the preset inherits", async () => {
    setupMockSettings(
      makePreset({ id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID, model: "" }),
    );
    (getDefaultModelId as Mock).mockReturnValue("ollama::llama3.2:3b");

    await fixGrammar("draft prompt");

    const { userPrompt, model } = (makeAIRequest as Mock).mock.calls[0][0];
    expect(userPrompt).toContain("- The selected target model ID is: llama3.2:3b.");
    expect(userPrompt).not.toContain("ollama::");
    expect(model).toBe("ollama::llama3.2:3b");
  });
});

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
    // Raw, like `makeAIRequest`, so history rows need no migration — and the
    // tag's own ":" must survive the split.
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
    withPresetModel("");
    (getDefaultModelId as Mock).mockReturnValue("");

    const result = await fixGrammar("   ");

    expect(result.provider).toBeUndefined();
    expect(result.model).toBe("");
    expect(result.resolvedModel).toBe("");
    expect(makeAIRequest).not.toHaveBeenCalled();
  });

  it("reports no provider for a bare (un-migrated) model id", async () => {
    // This branch has no model cache to resolve a bare id against, and a
    // guessed provider is silently written into history and priced.
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
// Tests: normalizeCorrectionSettings reasoning handling
// ---------------------------------------------------------------------------

describe("normalizeCorrectionSettings — reasoning field", () => {
  it("preserves a valid reasoning effort on a stored preset", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        {
          id: "custom-1",
          name: "Custom",
          hotkey: "",
          systemPrompt: "Do the thing.",
          model: "",
          isBuiltIn: false,
          reasoning: "xhigh",
        },
      ],
      selectedPresetId: "custom-1",
    });
    const preset = result.presets.find((p) => p.id === "custom-1");
    expect(preset?.reasoning).toBe("xhigh");
  });

  it("drops an unknown reasoning value from a stored preset", () => {
    const result = normalizeCorrectionSettings({
      presets: [
        {
          id: "custom-1",
          name: "Custom",
          hotkey: "",
          systemPrompt: "Do the thing.",
          model: "",
          isBuiltIn: false,
          reasoning: "turbo" as "medium",
        },
      ],
      selectedPresetId: "custom-1",
    });
    const preset = result.presets.find((p) => p.id === "custom-1");
    expect(preset?.reasoning).toBeUndefined();
  });
});

