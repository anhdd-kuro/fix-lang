/**
 * @file request.test.ts
 * @description `makeLmStudioAIRequest` reports the model LM Studio served, read
 * from `response.modelId` (`ai` v7 needs no `include` for it).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGenerateText } from "~/main/llm/providers/testing/fakeGenerateText";
import { makeLmStudioAIRequest } from "./request";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";

const { generateTextMock, openAIChatMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  openAIChatMock: vi.fn((modelId: string) => ({
    modelId,
    provider: "lmstudio.chat",
  })),
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

const requestOptions = (n?: number): AIRequestOptions => {
  const options: AIRequestOptions = {
    systemPrompt: "",
    userPrompt: "",
    model: REQUESTED_MODEL,
    messages: [{ role: "user" as const, content: "fix this" }],
  };
  if (n !== undefined) options.n = n;
  return options;
};

describe("makeLmStudioAIRequest", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("reports the served model from response.modelId, not the requested id", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "fixed",
        usage: { inputTokens: 3, outputTokens: 4 },
        modelId: SERVED_MODEL,
      }),
    );

    const result = await makeLmStudioAIRequest(requestOptions());

    expect(result.resolvedModel).toBe(SERVED_MODEL);
    expect(result.model).toBe(REQUESTED_MODEL);
    expect(result.content).toEqual(["fixed"]);
    expect(result.promptTokens).toBe(3);
    expect(result.completionTokens).toBe(4);
  });

  it("does not ask the SDK for the raw response body", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({ text: "fixed", modelId: SERVED_MODEL }),
    );

    await makeLmStudioAIRequest(requestOptions());

    expect(generateTextMock.mock.calls[0]?.[0].include).toBeUndefined();
  });

  it("fans out n > 1 into one call per choice and resolves the model from the first", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText([
        {
          text: "first",
          usage: { inputTokens: 2, outputTokens: 1 },
          modelId: SERVED_MODEL,
        },
        {
          text: "second",
          usage: { inputTokens: 2, outputTokens: 5 },
          modelId: "other",
        },
      ]),
    );

    const result = await makeLmStudioAIRequest(requestOptions(2));

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual(["first", "second"]);
    expect(result.promptTokens).toBe(4);
    expect(result.completionTokens).toBe(6);
    expect(result.resolvedModel).toBe(SERVED_MODEL);
  });

  it("falls back to the requested id when the SDK reports no model", async () => {
    // Defensive only: the real SDK always returns a `response` with a `modelId`; this guards a malformed result.
    generateTextMock.mockImplementation(async () => ({
      text: "fixed",
      usage: {},
      response: {},
    }));

    const result = await makeLmStudioAIRequest(requestOptions());

    expect(result.resolvedModel).toBe(REQUESTED_MODEL);
  });
});
