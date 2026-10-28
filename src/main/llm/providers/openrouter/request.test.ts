/**
 * @file request.test.ts
 * @description `makeOpenRouterAIRequest` takes the served model from
 * `response.modelId` and cache counts from `usage.inputTokenDetails`, both
 * available from `ai` v7 with no `include`. Only the `n > 1` choices fan-out
 * needs the raw body (`include: { responseBody: true }`). The shared fake
 * withholds the body otherwise and builds usage in the real OpenRouter shape
 * (`prompt_tokens_details.cached_tokens`), so reading the wrong field fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatCompletionBody,
  chatCompletionUsage,
  fakeGenerateText,
} from "~/main/llm/providers/testing/fakeGenerateText";
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

  it("does not request the response body for a single choice", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({ text: "the text", body: chatCompletionBody({ model: SERVED_MODEL, contents: ["the text"] }) }),
    );

    await request();
    await request(1);

    expect(generateTextMock.mock.calls[0]?.[0].include).toBeUndefined();
    expect(generateTextMock.mock.calls[1]?.[0].include).toBeUndefined();
  });

  it("requests the response body when n > 1", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "first",
        body: chatCompletionBody({ model: SERVED_MODEL, contents: ["first", "second"] }),
      }),
    );

    await request(2);

    expect(generateTextMock.mock.calls[0]?.[0].include).toEqual({ responseBody: true });
  });

  it("reports the concretely served model behind a floating alias without the body", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({ text: "the text", body: chatCompletionBody({ model: SERVED_MODEL, contents: ["the text"] }) }),
    );

    const result = await request();

    expect(generateTextMock.mock.calls[0]?.[0].include).toBeUndefined();
    expect(result.model).toBe(REQUESTED_MODEL);
    expect(result.resolvedModel).toBe(SERVED_MODEL);
  });

  it("falls back to the requested model when the SDK reports none", async () => {
    generateTextMock.mockResolvedValue({
      text: "the text",
      usage: { inputTokens: 1, outputTokens: 1 },
      response: {},
    });

    const result = await request();

    expect(result.resolvedModel).toBe(REQUESTED_MODEL);
  });

  it("reads cache read/write tokens from the SDK usage built from the real body shape", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "the text",
        body: chatCompletionBody({
          model: SERVED_MODEL,
          contents: ["the text"],
          usage: chatCompletionUsage({
            promptTokens: 40,
            completionTokens: 5,
            cachedTokens: 6,
            cacheWriteTokens: 2,
          }),
        }),
      }),
    );

    const result = await request();

    expect(result.cachedTokens).toBe(6);
    expect(result.cacheWriteTokens).toBe(2);
    expect(result.promptTokens).toBe(40);
    expect(result.completionTokens).toBe(5);
  });

  it("reports zero cache tokens when the provider sends no details", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "the text",
        body: chatCompletionBody({
          model: SERVED_MODEL,
          contents: ["the text"],
          usage: chatCompletionUsage({ promptTokens: 40, completionTokens: 5 }),
        }),
      }),
    );

    const result = await request();

    expect(result.cachedTokens).toBe(0);
    expect(result.cacheWriteTokens).toBe(0);
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
