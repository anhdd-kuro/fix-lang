/**
 * @file request.test.ts
 * @description Bedrock request path against the `generateText` fake in no-body
 * mode: the real Bedrock SDK returns no response body, so the served model
 * comes from `response.modelId`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGenerateText } from "~/main/llm/providers/testing/fakeGenerateText";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";
import { makeBedrockAIRequest } from "./request";

const { generateTextMock, getProfileSecretMock, notifyRequestErrorMock } =
  vi.hoisted(() => ({
    generateTextMock: vi.fn(),
    getProfileSecretMock: vi.fn(),
    notifyRequestErrorMock: vi.fn(),
  }));

vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: () => (modelId: string) => ({
    modelId,
    provider: "amazon-bedrock",
  }),
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  getCurrentProfileId: () => "profile-1",
  getProviderEndpoint: () => ({ host: "us-east-1" }),
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: getProfileSecretMock,
}));
// Pulls in Electron otherwise.
vi.mock("~/main/notifications/error", () => ({
  notifyRequestError: notifyRequestErrorMock,
}));

const MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

const request = (overrides: Partial<AIRequestOptions> = {}) =>
  makeBedrockAIRequest({
    systemPrompt: "",
    userPrompt: "",
    model: MODEL,
    messages: [
      { role: "system", content: "Fix grammar." },
      { role: "user", content: "teh text" },
    ],
    ...overrides,
  });

describe("makeBedrockAIRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {
      // Swallowed.
    });
    getProfileSecretMock.mockImplementation(
      async (_profile: string, _provider: string, kind: string) =>
        kind === "api" ? "AKIAEXAMPLE" : "secret-example",
    );
  });

  it("does not ask for a response body Bedrock never returns", async () => {
    generateTextMock.mockImplementation(fakeGenerateText({ text: "the text" }));

    await request();

    expect(generateTextMock.mock.calls[0]?.[0].include).toBeUndefined();
  });

  it("reports the model the SDK names on response.modelId", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "the text",
        usage: { inputTokens: 10, outputTokens: 4 },
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0-served",
      }),
    );

    const result = await request();

    expect(result.resolvedModel).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0-served",
    );
    expect(result.content).toEqual(["the text"]);
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(4);
  });

  it("falls back to the requested model when the SDK result names none", async () => {
    // Defensive only: the real SDK always returns a `response` with a `modelId`; this guards a malformed result.
    generateTextMock.mockImplementation(
      vi.fn(async () => ({ text: "the text", usage: {}, response: {} })),
    );

    const result = await request();

    expect(result.resolvedModel).toBe(MODEL);
  });

  it("returns every choice and sums tokens on the n > 1 fan-out", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText([
        {
          text: "first",
          usage: { inputTokens: 10, outputTokens: 3 },
          modelId: "served-model",
        },
        { text: "second", usage: { inputTokens: 10, outputTokens: 5 } },
      ]),
    );

    const result = await request({ n: 2 });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual(["first", "second"]);
    expect(result.promptTokens).toBe(20);
    expect(result.completionTokens).toBe(8);
    expect(result.resolvedModel).toBe("served-model");
  });
});
