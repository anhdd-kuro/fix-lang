/**
 * @file request.test.ts
 * @description `makeLmStudioAIRequest` against the realistic `generateText`
 * fake: `ai` v7 hands back `response.body` only when the call asks for it, so
 * the served model id (read from the body) is the regression this pins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGenerateText } from "~/main/llm/providers/testing/fakeGenerateText";
import { makeLmStudioAIRequest } from "./request";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";

const { generateTextMock, openAIChatMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  openAIChatMock: vi.fn((modelId: string) => ({ modelId, provider: "lmstudio.chat" })),
}));

vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({ chat: openAIChatMock })),
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  getCurrentProfileId: vi.fn(() => "profile-1"),
  getProviderEndpoint: vi.fn(() => undefined),
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/main/notifications/error", () => ({ notifyRequestError: vi.fn() }));

const REQUESTED_MODEL = "qwen3-8b";
const SERVED_MODEL = "qwen/qwen3-8b@q4_k_m";

const requestOptions = (n?: number): AIRequestOptions => ({
  systemPrompt: "",
  userPrompt: "",
  model: REQUESTED_MODEL,
  messages: [{ role: "user" as const, content: "fix this" }],
  ...(n !== undefined ? { n } : {}),
});

describe("makeLmStudioAIRequest", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("reports the served model from the response body, not the requested id", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "fixed",
        usage: { inputTokens: 3, outputTokens: 4 },
        // `modelId` set apart from the body so only a body read can yield SERVED_MODEL.
        modelId: REQUESTED_MODEL,
        body: { model: SERVED_MODEL },
      }),
    );

    const result = await makeLmStudioAIRequest(requestOptions());

    expect(result.resolvedModel).toBe(SERVED_MODEL);
    expect(generateTextMock.mock.calls[0]?.[0].include).toEqual({ responseBody: true });
    expect(result.model).toBe(REQUESTED_MODEL);
    expect(result.content).toEqual(["fixed"]);
    expect(result.promptTokens).toBe(3);
    expect(result.completionTokens).toBe(4);
  });

  it("fans out n > 1 into one call per choice and reads the first call's body", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText([
        {
          text: "first",
          usage: { inputTokens: 2, outputTokens: 1 },
          modelId: REQUESTED_MODEL,
          body: { model: SERVED_MODEL },
        },
        { text: "second", usage: { inputTokens: 2, outputTokens: 5 }, modelId: REQUESTED_MODEL },
      ]),
    );

    const result = await makeLmStudioAIRequest(requestOptions(2));

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    for (const [callOptions] of generateTextMock.mock.calls) {
      expect(callOptions.include).toEqual({ responseBody: true });
    }
    expect(result.content).toEqual(["first", "second"]);
    expect(result.promptTokens).toBe(4);
    expect(result.completionTokens).toBe(6);
    expect(result.resolvedModel).toBe(SERVED_MODEL);
  });

  it("falls back to the requested id when the body names no model", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({ text: "fixed", modelId: REQUESTED_MODEL, body: {} }),
    );

    const result = await makeLmStudioAIRequest(requestOptions());

    expect(result.resolvedModel).toBe(REQUESTED_MODEL);
  });
});
