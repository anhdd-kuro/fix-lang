/**
 * @file shared-logging.test.ts
 * @description Verifies shared AI request logs never expose prompt or response content.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatCompletionBody,
  fakeGenerateText,
} from "~/main/llm/providers/testing/fakeGenerateText";
import { makeAIRequest, makeOpenAIAIRequest, makeRemoteAIRequest } from "./shared";
const { createOpenAIMock, generateTextMock, getProfileSecretMock, notificationShowMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn(() => ({ chat: vi.fn(() => ({ provider: "openai" })) })),
  generateTextMock: vi.fn(),
  getProfileSecretMock: vi.fn(),
  notificationShowMock: vi.fn(),
}));

vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn(() => ({ provider: "openrouter" }))),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("electron", () => ({
  app: { isReady: vi.fn().mockReturnValue(true) },
  Notification: class {
    show = notificationShowMock;
    on = vi.fn().mockReturnThis();
  },
}));

// `~/main/notifications/error`'s notification title/body now go through
// `mainT()`, which reads `~/features/i18n/store/localeStore` (a real `electron-store`
// instance requiring a `projectName`/`cwd` outside a real Electron `app`).
// Mocking the store directly — same pattern as
// `keybindings/correctionNotifications.test.ts` — avoids that entirely.
vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: vi.fn(() => "en"),
}));

vi.mock("~/features/providers/store/apiKeyStore", () => ({
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("~/features/providers/store/apiStore", () => ({
  apiStore: {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  },
  getDefaultModelId: vi.fn().mockReturnValue("openai/gpt-4.1-mini"),
  getCurrentProfileId: vi.fn().mockReturnValue("profile_1"),
  getProfileById: vi.fn().mockReturnValue({ provider: "openrouter" }),
  getProfileSetting: vi.fn().mockReturnValue(undefined),
  updateProfileSetting: vi.fn().mockReturnValue({ success: true }),
  isModelForProvider: (
    model: { provider?: string; local?: unknown },
    provider: string,
  ): boolean =>
    provider === "ollama"
      ? model.provider === "ollama" || model.local !== undefined
      : model.provider === provider ||
        (provider === "openrouter" && model.provider === undefined && !model.local),
}));

vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: getProfileSecretMock,
}));

vi.mock("~/main/llm/models/discover", () => ({
  getLocalModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/main/llm/providers/ollama/client", () => ({
  createOllamaClient: () => ({ chat: vi.fn() }),
  ollamaClient: {
    chat: vi.fn(),
  },
}));

describe("shared AI request logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not log full prompts or provider response payloads", async () => {
    // The OpenRouter `n > 1` path is the one that requests the raw response
    // body (`include.responseBody`), so the payload really reaches the request
    // code; the fake returns a body only to a caller that asks for it.
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "PRIVATE_RESPONSE_TEXT",
        usage: { inputTokens: 3, outputTokens: 4 },
        modelId: "openai/gpt-4.1-mini-2025-04-14",
        body: {
          ...chatCompletionBody({
            model: "openai/gpt-4.1-mini-2025-04-14",
            contents: ["PRIVATE_CHOICE_ONE", "PRIVATE_CHOICE_TWO"],
          }),
          privatePayload: "PRIVATE_PROVIDER_PAYLOAD",
        },
      }),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await makeRemoteAIRequest({
      systemPrompt: "PRIVATE_SYSTEM_PROMPT",
      userPrompt: "PRIVATE_USER_PROMPT",
      model: "openai/gpt-4.1-mini",
      n: 2,
      messages: [
        { role: "system", content: "PRIVATE_SYSTEM_PROMPT" },
        { role: "user", content: "PRIVATE_USER_PROMPT" },
      ],
    });

    // The body was requested and delivered: the choices came out of it.
    expect(generateTextMock.mock.calls[0]?.[0].include).toEqual({
      responseBody: true,
    });
    expect(response.content).toEqual(["PRIVATE_CHOICE_ONE", "PRIVATE_CHOICE_TWO"]);
    expect(response.resolvedModel).toBe("openai/gpt-4.1-mini-2025-04-14");

    const serializedLogs = JSON.stringify([
      ...logSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]);
    expect(serializedLogs).not.toContain("PRIVATE_SYSTEM_PROMPT");
    expect(serializedLogs).not.toContain("PRIVATE_USER_PROMPT");
    expect(serializedLogs).not.toContain("PRIVATE_RESPONSE_TEXT");
    expect(serializedLogs).not.toContain("PRIVATE_CHOICE_ONE");
    expect(serializedLogs).not.toContain("PRIVATE_PROVIDER_PAYLOAD");
  });

  it("shows a desktop notification when a request cannot resolve its model", async () => {
    await expect(
      makeAIRequest({
        systemPrompt: "Fix grammar.",
        userPrompt: "Hello",
        model: "openai/missing-model",
      }),
      // A BARE id — `/` is an OpenRouter separator, not the `::` ref prefix —
      // so the message must name no provider.
    ).rejects.toThrow(
      'Model "openai/missing-model" is not available from any connected provider',
    );

    expect(notificationShowMock).toHaveBeenCalledOnce();
  });

  it("uses the direct OpenAI Chat Completions provider and fans out n requests", async () => {
    getProfileSecretMock.mockResolvedValue("direct-openai-key");
    generateTextMock.mockImplementation(
      fakeGenerateText([
        {
          text: "first",
          usage: { inputTokens: 2, outputTokens: 3 },
          modelId: "gpt-4.1-mini-2025",
        },
        {
          text: "second",
          usage: { inputTokens: 5, outputTokens: 7 },
          modelId: "gpt-4.1-mini-2025",
        },
      ]),
    );

    const response = await makeOpenAIAIRequest({
      systemPrompt: "system",
      userPrompt: "user",
      model: "gpt-4.1-mini",
      n: 2,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "user" },
      ],
    });

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "direct-openai-key",
      // The keep-alive dispatcher wired in `~/main/llm/httpKeepAlive.ts` (see
      // that module's own doc comment) — asserted as "a function" rather than
      // the exact reference, since this test doesn't mock that module.
      fetch: expect.any(Function),
    });
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls[0]?.[0]).not.toHaveProperty("include");
    expect(response).toMatchObject({
      content: ["first", "second"],
      provider: "openai",
      model: "gpt-4.1-mini",
      resolvedModel: "gpt-4.1-mini-2025",
      promptTokens: 7,
      completionTokens: 10,
    });
  });
});
