/**
 * @file promptgen.test.ts
 * @description Tests for `generatePrompt`'s option precedence over the stored
 * profile settings. Pure unit tests — no Electron, no IPC, no network.
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
// `promptgen.ts` → `~/utils` (StringPrettifier) → `~/main/notifications/error`
// → `errorPopupWindow` → `import … from "./overlay.html?asset"`, which vitest
// cannot parse as JS. Stubbing this one leaf keeps the REAL StringPrettifier,
// so the system-prompt assertions below still exercise the real formatting.
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
vi.mock("~/stores/apiStore", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.importActual returns unknown module shape
  const real = await importOriginal<any>();
  return {
    ...real,
    getProfileSetting: vi.fn(),
    apiStore: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
  };
});
vi.mock("./shared", () => ({ makeAIRequest: vi.fn() }));
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { getProfileSetting } from "~/stores/apiStore";
import { generatePrompt } from "./promptgen";
import { makeAIRequest } from "./shared";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StoredPromptGenSettings = {
  minLength: number;
  maxLength: number;
  batchCount: number;
  nsfw: boolean;
  context: string;
  autoCopy: boolean;
  model: string;
};

const storedSettings = (
  overrides: Partial<StoredPromptGenSettings> = {},
): StoredPromptGenSettings => ({
  minLength: 50,
  maxLength: 150,
  batchCount: 5,
  nsfw: true,
  context: "",
  autoCopy: false,
  model: "openrouter::openai/gpt-4o",
  ...overrides,
});

const setup = (overrides: Partial<StoredPromptGenSettings> = {}) => {
  (getProfileSetting as Mock).mockReturnValue(storedSettings(overrides));
  (makeAIRequest as Mock).mockResolvedValue({
    content: ["A generated prompt"],
    promptTokens: 10,
    completionTokens: 20,
    model: "openai/gpt-4o",
    provider: "openrouter",
    resolvedModel: "openai/gpt-4o",
  });
};

/** The single options object `generatePrompt` handed to `makeAIRequest`. */
const requestOptions = (): Record<string, unknown> =>
  (makeAIRequest as Mock).mock.calls[0][0];

// ---------------------------------------------------------------------------
// Option precedence
//
// The spread order was `{ ...options, ...currentSettings }`, so the stored
// profile setting overwrote whatever the CALLER explicitly asked for — an
// explicit `model` was silently discarded. This is a real pre-existing bug,
// not a refactor artifact: it is invisible today only because the sole
// in-tree caller (`keybindings/promptGen.ts`) passes `{ text }` and nothing
// else, so the two objects never collide.
// ---------------------------------------------------------------------------

describe("generatePrompt — explicit options beat the stored profile setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an explicit options.model over the profile's settingsPromptGen.model", async () => {
    setup({ model: "openrouter::openai/gpt-4o" });

    await generatePrompt({ text: "hello", model: "ollama::llama3.2:3b" });

    expect(requestOptions().model).toBe("ollama::llama3.2:3b");
  });

  it("uses an explicit options.temperature over the stored settings", async () => {
    setup();

    await generatePrompt({ text: "hello", temperature: 0.9 });

    expect(requestOptions().temperature).toBe(0.9);
  });

  it("still falls back to the stored model when the caller passes none", async () => {
    // The precedence fix must not turn "caller said nothing" into "caller said
    // undefined" — the profile setting is still the default.
    setup({ model: "openrouter::openai/gpt-4o" });

    await generatePrompt({ text: "hello" });

    expect(requestOptions().model).toBe("openrouter::openai/gpt-4o");
  });

  it("passes the inherit sentinel through untouched when the profile inherits", async () => {
    setup({ model: "" });

    await generatePrompt({ text: "hello" });

    expect(requestOptions().model).toBe("");
  });

  it("leaves the derived system and user prompts alone", async () => {
    // Both are computed before the spreads; neither object carries those keys,
    // and the swap must not change that.
    setup();

    await generatePrompt({ text: "hello", model: "openai::gpt-4o" });

    expect(requestOptions().userPrompt).toBe("Input:\nhello");
    expect(String(requestOptions().systemPrompt)).toContain("50 ~ 150");
  });

  it("honours an explicit minLength/maxLength in the system prompt", async () => {
    setup({ minLength: 50, maxLength: 150 });

    await generatePrompt({ text: "hello", minLength: 10, maxLength: 20 });

    expect(String(requestOptions().systemPrompt)).toContain("10 ~ 20");
  });

  it("returns the provider and raw model the request reported", async () => {
    setup();

    const result = await generatePrompt({ text: "hello" });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("openai/gpt-4o");
    expect(result.resolvedModel).toBe("openai/gpt-4o");
    expect(result.prompts).toEqual(["A generated prompt"]);
  });
});
