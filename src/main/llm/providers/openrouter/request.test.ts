/**
 * @file request.test.ts
 * @description `makeOpenRouterAIRequest` reads three things off the raw
 * response body: the served model, cache usage, and `n > 1` choices. `ai` v7
 * returns that body only when `generateText` is called with
 * `include: { responseBody: true }`, so these tests run on the shared realistic
 * fake, which withholds the body otherwise.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatCompletionBody, fakeGenerateText } from "~/main/llm/providers/testing/fakeGenerateText";
import { makeOpenRouterAIRequest } from "./request";

const { generateTextMock, createOpenRouterMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  createOpenRouterMock: vi.fn(() => (modelId: string) => ({ modelId, provider: "openrouter" })),
}));

vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter: createOpenRouterMock }));
vi.mock("~/features/providers/store/apiKeyStore", () => ({
  getApiKey: vi.fn().mockResolvedValue("sk-or-test"),
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  apiStore: { get: vi.fn() },
  getProfileSetting: vi.fn(),
}));
vi.mock("~/main/notifications/error", () => ({ notifyRequestError: vi.fn() }));
vi.mock("~/main/llm/httpKeepAlive", () => ({ keepAliveFetch: vi.fn() }));

const REQUESTED_MODEL = "~openai/gpt-mini-latest";
const SERVED_MODEL = "openai/gpt-5.4-mini-20260317";

const request = (n?: number) =>
  makeOpenRouterAIRequest({
    systemPrompt: "",
    userPrompt: "",
    model: REQUESTED_MODEL,
    ...(n !== undefined ? { n } : {}),
    messages: [
      { role: "system", content: "Fix grammar." },
      { role: "user", content: "teh text" },
    ],
  });

describe("makeOpenRouterAIRequest response body", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("asks the SDK for the response body", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({ text: "the text", body: chatCompletionBody({ model: SERVED_MODEL, contents: ["the text"] }) }),
    );

    await request();

    expect(generateTextMock.mock.calls[0]?.[0].include).toEqual({ responseBody: true });
  });

  it("reports the concretely served model behind a floating alias", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({ text: "the text", body: chatCompletionBody({ model: SERVED_MODEL, contents: ["the text"] }) }),
    );

    const result = await request();

    expect(result.model).toBe(REQUESTED_MODEL);
    expect(result.resolvedModel).toBe(SERVED_MODEL);
  });

  it("reads cache read/write tokens from the body usage", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "the text",
        usage: { inputTokens: 40, outputTokens: 5 },
        body: chatCompletionBody({
          model: SERVED_MODEL,
          contents: ["the text"],
          usage: { cache_read_input_tokens: 6, cache_creation_input_tokens: 2 },
        }),
      }),
    );

    const result = await request();

    expect(result.cachedTokens).toBe(6);
    expect(result.cacheWriteTokens).toBe(2);
    expect(result.promptTokens).toBe(40);
    expect(result.completionTokens).toBe(5);
  });

  it("returns every choice when n > 1", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "first",
        body: chatCompletionBody({ model: SERVED_MODEL, contents: ["first", " second "] }),
      }),
    );

    const result = await request(2);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual(["first", "second"]);
  });
});
