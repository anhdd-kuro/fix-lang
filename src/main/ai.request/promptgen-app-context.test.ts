/**
 * @file promptgen-app-context.test.ts
 * @description Tests that PromptGen carries the same source-app context on its
 * system prompt as the transform path. Pure unit tests — no Electron, no network.
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
  clipboard: { readText: vi.fn().mockReturnValue(""), writeText: vi.fn() },
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
// deleted it, and `promptgen.ts` no longer imports it. Mocking a symbol the
// module under test cannot import would only make this file lie about the
// shape of `./shared`.
vi.mock("./shared", () => ({
  makeAIRequest: vi.fn(),
}));
// `promptgen` pulls the real `StringPrettifier` from `~/utils`, whose error
// types reach `errorPopupWindow` → `overlay.html?asset`, which vite cannot
// parse as JS under vitest. Stub that leaf so the prettifier stays real.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { getProfileSetting } from "~/features/providers/store/apiStore";
import { generatePrompt } from "./promptgen";
import { makeAIRequest } from "./shared";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const setup = () => {
  (getProfileSetting as Mock).mockReturnValue({
    context: "Generate image prompts.",
    minLength: 10,
    maxLength: 50,
    nsfw: false,
  });
  (makeAIRequest as Mock).mockResolvedValue({
    content: ["a prompt"],
    promptTokens: 10,
    completionTokens: 20,
    model: "openai/gpt-4o",
    provider: "openrouter",
  });
};

const lastCall = () => (makeAIRequest as Mock).mock.calls[0][0];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generatePrompt — active app context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it("appends the source app to the system prompt", async () => {
    await generatePrompt({ text: "a cat", activeAppName: "Figma" });

    const { systemPrompt } = lastCall();
    expect(systemPrompt).toContain("Generate image prompts.");
    expect(systemPrompt).toContain('"Figma"');
    expect(systemPrompt).toMatch(/do not mention/i);
  });

  it("keeps the context block's line structure after prettifying", async () => {
    await generatePrompt({ text: "a cat", activeAppName: "Figma" });

    // `StringPrettifier.removeExtraSpaces` runs on the base prompt only; the
    // block is appended afterwards, so its bullets stay on their own lines.
    expect(lastCall().systemPrompt).toContain(
      '\n- The text was selected in the macOS app "Figma".',
    );
  });

  it("omits the block when no app name is known", async () => {
    await generatePrompt({ text: "a cat" });

    expect(lastCall().systemPrompt).not.toMatch(/macOS app/);
  });

  it("omits the block for a blank app name", async () => {
    await generatePrompt({ text: "a cat", activeAppName: "  " });

    expect(lastCall().systemPrompt).not.toMatch(/macOS app/);
  });

  it("does not confuse the user-authored context override with the app name", async () => {
    await generatePrompt({
      text: "a cat",
      context: "Write haiku prompts.",
      activeAppName: "Notes",
    });

    const { systemPrompt } = lastCall();
    expect(systemPrompt).toContain("Write haiku prompts.");
    expect(systemPrompt).toContain('"Notes"');
  });
});
