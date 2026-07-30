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
vi.mock("~/features/providers/store/apiStore", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- importOriginal returns unknown module shape
  const real = await importOriginal<any>();
  return {
    ...real,
    getProfileSetting: vi.fn(),
    apiStore: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
  };
});
// `getActiveProvider` is deliberately absent: the multi-provider refactor
// deleted it, and `correction.ts` no longer imports it. Mocking a symbol the
// module under test cannot import would only make this file lie about the
// shape of `./shared`.
vi.mock("./shared", () => ({
  makeAIRequest: vi.fn(),
}));
// `./promptgen` pulls the real `StringPrettifier` from `~/utils`, whose error
// types reach `errorPopupWindow` → `overlay.html?asset`, which vite cannot
// parse as JS under vitest. Stub that leaf so the prettifier stays real (see
// `promptgen-app-context.test.ts`, which does the same).
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { getProfileSetting } from "~/features/providers/store/apiStore";
import {
  DEFAULT_BUSINESS_WRITING_PRESET_ID,
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_STRUCTURED_TEXT_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
} from "~/prompts";
import { fixGrammar } from "./correction";
import { generatePrompt } from "./promptgen";
import { makeAIRequest } from "./shared";
import type { Mock } from "vitest";
import type { CorrectionPreset, CorrectionSettings } from "~/features/providers/store/apiStore";

const PRESERVE_MARKUP_BULLET =
  "do not add app-specific markup the input does not already use";

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

  it("prepends the source app to the preset's system prompt", async () => {
    setup(makePreset({ systemPrompt: "Fix grammar." }));

    await fixGrammar("hello world", undefined, { activeAppName: "Slack" });

    const { systemPrompt } = lastCall();
    // The context block leads so it carries more weight than the preset's own instructions.
    expect(systemPrompt.endsWith("Fix grammar.")).toBe(true);
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

  it("uses the adapt-to-app block for the structured-text preset only", async () => {
    setup(
      makePreset({
        id: DEFAULT_STRUCTURED_TEXT_PRESET_ID,
        systemPrompt: "Restructure the text.",
      }),
    );

    await fixGrammar("hello world", DEFAULT_STRUCTURED_TEXT_PRESET_ID, {
      activeAppName: "Slack",
    });

    const { systemPrompt } = lastCall();
    expect(systemPrompt.endsWith("Restructure the text.")).toBe(true);
    expect(systemPrompt).toContain('"Slack"');
    expect(systemPrompt).toMatch(/do not mention the app/i);
    expect(systemPrompt).not.toContain(PRESERVE_MARKUP_BULLET);
  });

  it("does not alter the user prompt for the structured-text preset", async () => {
    setup(makePreset({ id: DEFAULT_STRUCTURED_TEXT_PRESET_ID }));

    await fixGrammar("hello world", DEFAULT_STRUCTURED_TEXT_PRESET_ID, {
      activeAppName: "Slack",
    });

    expect(lastCall().userPrompt).toBe("Input:\nhello world");
  });

  it("does not alter the user prompt for the business-writing preset", async () => {
    setup(makePreset({ id: DEFAULT_BUSINESS_WRITING_PRESET_ID }));

    await fixGrammar("hello world", DEFAULT_BUSINESS_WRITING_PRESET_ID, {
      activeAppName: "Slack",
    });

    expect(lastCall().userPrompt).toBe("Input:\nhello world");
  });

  it.each([
    ["business-writing", DEFAULT_BUSINESS_WRITING_PRESET_ID],
    ["correction", DEFAULT_CORRECTION_PRESET_ID],
    ["summarize", DEFAULT_SUMMARIZE_PRESET_ID],
    ["prompt-optimization", DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID],
    ["a custom preset id", "my-custom-preset"],
  ])("keeps the preserve-input-markup block for %s", async (_label, id) => {
    setup(makePreset({ id, systemPrompt: "Do the thing." }));

    await fixGrammar("hello world", id, { activeAppName: "Slack" });

    expect(lastCall().systemPrompt).toContain(PRESERVE_MARKUP_BULLET);
  });
});

describe("generatePrompt — active app context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still carries the preserve-input-markup block, unaffected by the structured-text policy", async () => {
    (getProfileSetting as Mock).mockReturnValue({
      minLength: 0,
      maxLength: 0,
      batchCount: 1,
      nsfw: false,
      context: "Generate a prompt.",
      autoCopy: false,
      model: "openai/gpt-4o",
    });
    (makeAIRequest as Mock).mockResolvedValue({
      content: ["result"],
      promptTokens: 10,
      completionTokens: 20,
      model: "gpt-4o",
      provider: "openai",
      resolvedModel: "gpt-4o",
    });

    await generatePrompt({ text: "hello world", activeAppName: "Slack" });

    const { systemPrompt } = (makeAIRequest as Mock).mock.calls[0][0];
    expect(systemPrompt).toContain('"Slack"');
    expect(systemPrompt).toContain(PRESERVE_MARKUP_BULLET);
  });
});
