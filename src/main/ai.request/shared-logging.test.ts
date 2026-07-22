/**
 * @file shared-logging.test.ts
 * @description Verifies shared AI request logs never expose prompt or response content.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("~/stores/apiKeyStore", () => ({
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));

vi.mock("~/stores/apiStore", () => ({
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

vi.mock("~/stores/profileSecretStore", () => ({
  getProfileSecret: getProfileSecretMock,
}));

vi.mock("~/main/llm/models/discover", () => ({
  getLocalModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("../llm", () => ({
  ollamaClient: {
    chat: vi.fn(),
  },
}));

describe("shared AI request logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateTextMock.mockResolvedValue({
      text: "PRIVATE_RESPONSE_TEXT",
      usage: {
        promptTokens: 3,
        completionTokens: 4,
      },
      response: {
        body: {
          model: "openai/gpt-4.1-mini",
          privatePayload: "PRIVATE_PROVIDER_PAYLOAD",
        },
      },
    });
  });

  it("does not log full prompts or provider response payloads", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await makeRemoteAIRequest({
      systemPrompt: "PRIVATE_SYSTEM_PROMPT",
      userPrompt: "PRIVATE_USER_PROMPT",
      model: "openai/gpt-4.1-mini",
      temperature: 0.2,
      maxTokens: 1024,
      messages: [
        { role: "system", content: "PRIVATE_SYSTEM_PROMPT" },
        { role: "user", content: "PRIVATE_USER_PROMPT" },
      ],
    });

    const serializedLogs = JSON.stringify(logSpy.mock.calls);
    expect(serializedLogs).not.toContain("PRIVATE_SYSTEM_PROMPT");
    expect(serializedLogs).not.toContain("PRIVATE_USER_PROMPT");
    expect(serializedLogs).not.toContain("PRIVATE_RESPONSE_TEXT");
    expect(serializedLogs).not.toContain("PRIVATE_PROVIDER_PAYLOAD");
  });

  it("shows a desktop notification when a request cannot resolve its model", async () => {
    await expect(
      makeAIRequest({
        systemPrompt: "Fix grammar.",
        userPrompt: "Hello",
        model: "openai/missing-model",
      }),
    ).rejects.toThrow("Model openai/missing-model not found in model registry.");

    expect(notificationShowMock).toHaveBeenCalledOnce();
  });

  it("uses the direct OpenAI Chat Completions provider and fans out n requests", async () => {
    getProfileSecretMock.mockResolvedValue("direct-openai-key");
    generateTextMock
      .mockResolvedValueOnce({
        text: "first",
        usage: { inputTokens: 2, outputTokens: 3 },
        response: { body: { model: "gpt-4.1-mini-2025" } },
      })
      .mockResolvedValueOnce({
        text: "second",
        usage: { inputTokens: 5, outputTokens: 7 },
        response: { body: { model: "gpt-4.1-mini-2025" } },
      });

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

    expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: "direct-openai-key" });
    expect(generateTextMock).toHaveBeenCalledTimes(2);
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
