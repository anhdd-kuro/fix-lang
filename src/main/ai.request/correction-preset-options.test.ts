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
vi.mock("~/features/providers/store/apiStore", async (importOriginal) => {
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
import {
  getDefaultModelId,
  getProfileSetting,
  normalizeCorrectionSettings,
} from "~/features/providers/store/apiStore";
import { DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID } from "~/prompts";
import {
  DEFAULT_CAVEMAN_FULL_DIRECTIVE,
  DEFAULT_CAVEMAN_LITE_DIRECTIVE,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
} from "~/prompts/correction";
import { effectiveModelRef, fixGrammar } from "./correction";
import { makeAIRequest } from "./shared";
import type { Mock } from "vitest";
import type { CorrectionPreset, CorrectionSettings } from "~/features/providers/store/apiStore";

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


describe("fixGrammar — prompt-optimization user prompt", () => {
  const PROMPT_OPTIMIZATION_REF = "openrouter::google/gemma-2-9b-it";

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockSettings(
      makePreset({
        id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
        model: PROMPT_OPTIMIZATION_REF,
      }),
    );
  });

  it("does not inject the preset model into the user prompt", async () => {
    await fixGrammar("draft prompt");

    const { userPrompt } = (makeAIRequest as Mock).mock.calls[0][0];
    expect(userPrompt).not.toContain("target model");
    expect(userPrompt).not.toContain("openrouter::");
    expect(userPrompt).not.toContain("google/gemma-2-9b-it");
  });

  it("still routes on the composite ref", async () => {
    await fixGrammar("draft prompt");

    const { model } = (makeAIRequest as Mock).mock.calls[0][0];
    expect(model).toBe(PROMPT_OPTIMIZATION_REF);
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
// Tests: fixGrammar composes the preset's declared options onto the system
// prompt. `withPresetOptions` is the INNERMOST wrapper, so the directive lands
// directly after the preset's own instructions and BEFORE the source-app and
// user-metadata blocks — whose `# Metadata context` section stays trailing.
// ---------------------------------------------------------------------------

describe("fixGrammar — Caveman intensity composed into the system prompt", () => {
  const CAVEMAN_BASE_PROMPT = "Compress the text.";

  // Hardcoded, not read back out of the registry: an expectation recomputed
  // the way the implementation computes it would move in lockstep with a
  // mutated fragment and never catch the regression. The three literals below
  // are the ones `src/prompts/correction.ts` exports for each level.
  const DIRECTIVE_BY_MODE: Record<string, string> = {
    lite: DEFAULT_CAVEMAN_LITE_DIRECTIVE,
    full: DEFAULT_CAVEMAN_FULL_DIRECTIVE,
    ultra: DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
  };

  const setupCaveman = (extraOptions?: Record<string, string>) => {
    setupMockSettings(
      makePreset({
        id: DEFAULT_CAVEMAN_PRESET_ID,
        name: "Caveman",
        systemPrompt: CAVEMAN_BASE_PROMPT,
        ...(extraOptions ? { extraOptions } : {}),
      }),
    );
  };

  const systemPromptOfLastCall = (): string =>
    (makeAIRequest as Mock).mock.calls[0][0].systemPrompt;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["lite", "full", "ultra"])(
    "appends the %s directive, and only that one",
    async (mode) => {
      setupCaveman({ cavemanMode: mode });

      await fixGrammar("some text");

      const systemPrompt = systemPromptOfLastCall();
      expect(systemPrompt).toBe(
        `${CAVEMAN_BASE_PROMPT}\n\n${DIRECTIVE_BY_MODE[mode]}`,
      );

      for (const [otherMode, directive] of Object.entries(DIRECTIVE_BY_MODE)) {
        if (otherMode === mode) continue;
        expect(systemPrompt).not.toContain(directive);
      }
    },
  );

  it("falls back to the registry default when the preset stores no option", async () => {
    setupCaveman();

    await fixGrammar("some text");

    expect(systemPromptOfLastCall()).toBe(
      `${CAVEMAN_BASE_PROMPT}\n\n${DEFAULT_CAVEMAN_FULL_DIRECTIVE}`,
    );
  });

  it("falls back to the registry default when the stored value is unrecognized", async () => {
    setupCaveman({ cavemanMode: "supersonic" });

    await fixGrammar("some text");

    expect(systemPromptOfLastCall()).toBe(
      `${CAVEMAN_BASE_PROMPT}\n\n${DEFAULT_CAVEMAN_FULL_DIRECTIVE}`,
    );
  });

  it("keeps the directive ahead of the source-app and metadata blocks", async () => {
    setupCaveman({ cavemanMode: "ultra" });

    await fixGrammar("some text", undefined, {
      activeAppName: "Slack",
      userMetadata: "App locale: en",
    });

    const systemPrompt = systemPromptOfLastCall();
    expect(systemPrompt.startsWith(CAVEMAN_BASE_PROMPT)).toBe(true);
    expect(systemPrompt.indexOf(DEFAULT_CAVEMAN_ULTRA_DIRECTIVE)).toBeLessThan(
      systemPrompt.indexOf("# Metadata context"),
    );
    expect(systemPrompt.indexOf("# Metadata context")).toBeLessThan(
      systemPrompt.indexOf("App locale: en"),
    );
  });

  it("leaves a preset that declares no options byte-identical", async () => {
    setupMockSettings(makePreset({ systemPrompt: "Fix grammar." }));

    await fixGrammar("some text");

    expect(systemPromptOfLastCall()).toBe("Fix grammar.");
  });

  it("ignores a cavemanMode stored against a preset that never declared it", async () => {
    setupMockSettings(
      makePreset({
        systemPrompt: "Fix grammar.",
        extraOptions: { cavemanMode: "ultra" },
      }),
    );

    await fixGrammar("some text");

    expect(systemPromptOfLastCall()).toBe("Fix grammar.");
  });
});

// ---------------------------------------------------------------------------
// Tests: effectiveModelRef — the inherit rule the connection prewarmer
// (`~/main/llm/prewarm.ts`) reuses to know what to warm before the real
// request is built.
// ---------------------------------------------------------------------------

describe("effectiveModelRef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the preset's own (trimmed) model ref when it has one", () => {
    (getDefaultModelId as Mock).mockReturnValue("openrouter::should-not-be-used");

    expect(effectiveModelRef(makePreset({ model: "  openai::gpt-4o  " }))).toBe(
      "openai::gpt-4o",
    );
    expect(getDefaultModelId).not.toHaveBeenCalled();
  });

  it("inherits the global default when the preset's model is empty", () => {
    (getDefaultModelId as Mock).mockReturnValue("ollama::llama3.2:3b");

    expect(effectiveModelRef(makePreset({ model: "" }))).toBe("ollama::llama3.2:3b");
  });

  it("inherits the global default when the preset's model is whitespace-only", () => {
    (getDefaultModelId as Mock).mockReturnValue("openai::gpt-4o");

    expect(effectiveModelRef(makePreset({ model: "   " }))).toBe("openai::gpt-4o");
  });

  it("propagates the inherit sentinel when the global default is also unset", () => {
    (getDefaultModelId as Mock).mockReturnValue("");

    expect(effectiveModelRef(makePreset({ model: "" }))).toBe("");
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
          reasoning: "high",
        },
      ],
      selectedPresetId: "custom-1",
    });
    const preset = result.presets.find((p) => p.id === "custom-1");
    expect(preset?.reasoning).toBe("high");
  });

  it("steps a retired reasoning effort down instead of dropping it", () => {
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
    expect(preset?.reasoning).toBe("high");
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

