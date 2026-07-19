/**
 * @file shared-logging.test.ts
 * @description Verifies shared AI request logs never expose prompt or response content.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRemoteAIRequest } from "./shared";
const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn(() => ({ provider: "openrouter" }))),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("electron", () => ({
  Notification: vi.fn().mockImplementation(
    class {
      show = vi.fn();
    },
  ),
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
  getProfileSetting: vi.fn().mockReturnValue(undefined),
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
});
