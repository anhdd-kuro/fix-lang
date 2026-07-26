/**
 * @file correction-app-context.test.ts
 * @description Tests for the frontmost-app context block that `fixGrammar`
 * appends to the preset's system prompt. Pure unit tests — no Electron, no network.
 */
// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  Notification: class {
    show = vi.fn();
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));
vi.mock("~/stores/apiStore", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- importOriginal returns unknown module shape
  const real = await importOriginal<any>();
  return {
    ...real,
    getProfileSetting: vi.fn(),
    apiStore: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
  };
});
vi.mock("./shared", () => ({
  makeAIRequest: vi.fn(),
  getActiveProvider: vi.fn().mockReturnValue("openrouter"),
}));
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import {
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
} from "~/prompts";
import { getProfileSetting } from "~/stores/apiStore";
import { fixGrammar } from "./correction";
import { makeAIRequest } from "./shared";
import type { Mock } from "vitest";
import type { CorrectionPreset, CorrectionSettings } from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePreset = (
  overrides: Partial<CorrectionPreset> = {},
): CorrectionPreset => ({
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

const setup = (preset: CorrectionPreset) => {
  (getProfileSetting as Mock).mockReturnValue(makeSettings(preset));
  (makeAIRequest as Mock).mockResolvedValue({
    content: ["Fixed text"],
    promptTokens: 10,
    completionTokens: 20,
    model: preset.model,
  });
};

const lastCall = () => (makeAIRequest as Mock).mock.calls[0][0];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fixGrammar — active app context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends the source app to the preset's system prompt", async () => {
    setup(makePreset({ systemPrompt: "Fix grammar." }));

    await fixGrammar("hello world", undefined, { activeAppName: "Slack" });

    const { systemPrompt } = lastCall();
    // The preset's own instructions keep the leading position.
    expect(systemPrompt.startsWith("Fix grammar.")).toBe(true);
    expect(systemPrompt).toContain('"Slack"');
    expect(systemPrompt).toMatch(/do not mention/i);
  });

  it("keeps the app name out of the user prompt, which carries only the text", async () => {
    setup(makePreset());

    await fixGrammar("hello world", undefined, { activeAppName: "Slack" });

    // Metadata next to the text is easy for a model to mistake for content.
    expect(lastCall().userPrompt).toBe("Input:\nhello world");
  });

  it("leaves the system prompt untouched when no app name is known", async () => {
    setup(makePreset({ systemPrompt: "Fix grammar." }));

    await fixGrammar("hello world");

    // Byte-identical to the pre-feature prompt: a failed frontmost-app read
    // must not perturb the transform at all.
    expect(lastCall().systemPrompt).toBe("Fix grammar.");
    expect(lastCall().userPrompt).toBe("Input:\nhello world");
  });

  it("leaves the system prompt untouched for a blank app name", async () => {
    setup(makePreset({ systemPrompt: "Fix grammar." }));

    await fixGrammar("hello world", undefined, { activeAppName: "   " });
    expect(lastCall().systemPrompt).toBe("Fix grammar.");

    vi.clearAllMocks();
    setup(makePreset({ systemPrompt: "Fix grammar." }));
    await fixGrammar("hello world", undefined, { activeAppName: null });
    expect(lastCall().systemPrompt).toBe("Fix grammar.");
  });

  it("adds the context for the summarize preset without touching its user-prompt rules", async () => {
    setup(
      makePreset({
        id: DEFAULT_SUMMARIZE_PRESET_ID,
        systemPrompt: "Summarize.",
      }),
    );

    await fixGrammar("hello world", DEFAULT_SUMMARIZE_PRESET_ID, {
      activeAppName: "Notes",
    });

    expect(lastCall().systemPrompt).toContain('"Notes"');
    expect(lastCall().userPrompt).toContain("Return only the summary text.");
    expect(lastCall().userPrompt).not.toContain("Notes");
  });

  it("adds the context for the prompt-optimization preset without touching its user-prompt rules", async () => {
    setup(
      makePreset({
        id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
        systemPrompt: "Optimize.",
      }),
    );

    await fixGrammar("hello world", DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID, {
      activeAppName: "Cursor",
    });

    expect(lastCall().systemPrompt).toContain('"Cursor"');
    expect(lastCall().userPrompt).toContain(
      "Return only the final optimized prompt text, ready to paste.",
    );
  });
});
