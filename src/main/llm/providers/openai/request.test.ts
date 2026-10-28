/**
 * @file request.test.ts
 * @description Direct OpenAI requests read the served model id from the raw
 * response body. Since `ai` v7, `generateText` returns that body only when the
 * call passes `include: { responseBody: true }`; without it every request
 * reported the requested alias as the resolved model. The realistic fake
 * withholds the body the same way, so these tests fail if the flag is dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGenerateText } from "~/main/llm/providers/testing/fakeGenerateText";
import { makeOpenAIAIRequest } from "./request";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";

const { generateTextMock, getProfileSecretMock, notifyRequestErrorMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getProfileSecretMock: vi.fn(),
  notifyRequestErrorMock: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ chat: (modelId: string) => ({ provider: "openai", modelId }) }),
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  getCurrentProfileId: () => "profile-1",
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: getProfileSecretMock,
}));
// Pulls in Electron otherwise.
vi.mock("~/main/notifications/error", () => ({ notifyRequestError: notifyRequestErrorMock }));

const REQUESTED_MODEL = "gpt-4o";
const SERVED_MODEL = "gpt-4o-2024-11-20";

const request = (overrides: Partial<AIRequestOptions> = {}) =>
  makeOpenAIAIRequest({
    systemPrompt: "Fix grammar.",
    userPrompt: "i has a apple",
    model: REQUESTED_MODEL,
    messages: [
      { role: "system", content: "Fix grammar." },
      { role: "user", content: "i has a apple" },
    ],
    quiet: true,
    ...overrides,
  });

describe("makeOpenAIAIRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProfileSecretMock.mockResolvedValue("sk-test");
  });

  it("asks the SDK for the raw response body", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({ text: "I have an apple.", body: { model: SERVED_MODEL } }),
    );

    await request();

    expect(generateTextMock.mock.calls[0]?.[0].include).toEqual({ responseBody: true });
  });

  it("reports the served model from the response body, not the requested alias", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "I have an apple.",
        usage: { inputTokens: 11, outputTokens: 5 },
        body: { model: SERVED_MODEL },
      }),
    );

    const result = await request();

    expect(result).toMatchObject({
      content: ["I have an apple."],
      model: REQUESTED_MODEL,
      resolvedModel: SERVED_MODEL,
      promptTokens: 11,
      completionTokens: 5,
      provider: "openai",
    });
  });

  it("fans n > 1 out into one call per choice and resolves the model from the first", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText([
        { text: "first", usage: { inputTokens: 10, outputTokens: 2 }, body: { model: SERVED_MODEL } },
        { text: "second", usage: { inputTokens: 10, outputTokens: 3 }, body: { model: "other" } },
      ]),
    );

    const result = await request({ n: 2 });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    // Only the first choice's body is read, so only that call pays for it.
    expect(generateTextMock.mock.calls[0]?.[0].include).toEqual({ responseBody: true });
    expect(generateTextMock.mock.calls[1]?.[0].include).toBeUndefined();
    expect(result.content).toEqual(["first", "second"]);
    expect(result.resolvedModel).toBe(SERVED_MODEL);
    expect(result.promptTokens).toBe(20);
    expect(result.completionTokens).toBe(5);
  });

  it("falls back to the requested model when the body omits it", async () => {
    generateTextMock.mockImplementation(fakeGenerateText({ text: "ok", body: {} }));

    const result = await request();

    expect(result.resolvedModel).toBe(REQUESTED_MODEL);
  });
});
