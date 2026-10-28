/**
 * @file request.test.ts
 * @description The served model must come back from the Anthropic path.
 *
 * Since `ai` v7, `generateText` resolves `response.body` only when the call
 * passes `include: { responseBody: true }`. Without it, `resolvedModel` silently
 * collapses to the requested id. The shared fake keeps that v7 rule, so these
 * tests fail the way production does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGenerateText } from "~/main/llm/providers/testing/fakeGenerateText";
import { makeAnthropicAIRequest } from "./request";

const { generateTextMock, createAnthropicMock, notifyRequestErrorMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  createAnthropicMock: vi.fn(),
  notifyRequestErrorMock: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: createAnthropicMock }));
// Pulls in Electron otherwise.
vi.mock("~/main/notifications/error", () => ({ notifyRequestError: notifyRequestErrorMock }));
vi.mock("~/main/llm/httpKeepAlive", () => ({ keepAliveFetch: vi.fn() }));
vi.mock("~/features/providers/store/apiStore", () => ({
  getCurrentProfileId: () => "profile-1",
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: async () => "sk-ant-test",
}));

const REQUESTED_MODEL = "claude-sonnet-4-5";
const SERVED_MODEL = "claude-sonnet-4-5-20250929";

const request = (overrides: Record<string, unknown> = {}) =>
  makeAnthropicAIRequest({
    systemPrompt: "Fix grammar.",
    userPrompt: "he go home",
    model: REQUESTED_MODEL,
    messages: [
      { role: "system", content: "Fix grammar." },
      { role: "user", content: "he go home" },
    ],
    ...overrides,
  });

describe("makeAnthropicAIRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {
      // Swallowed.
    });
    createAnthropicMock.mockReturnValue((modelId: string) => ({ modelId }));
    generateTextMock.mockImplementation(
      fakeGenerateText({
        text: "He goes home.",
        usage: { inputTokens: 12, outputTokens: 4 },
        body: { model: SERVED_MODEL },
      }),
    );
  });

  it("asks the SDK for the response body", async () => {
    await request();

    expect(generateTextMock.mock.calls[0]?.[0].include).toEqual({ responseBody: true });
  });

  it("reports the served model from the response body, not the requested id", async () => {
    const result = await request();

    expect(result.resolvedModel).toBe(SERVED_MODEL);
    expect(result.model).toBe(REQUESTED_MODEL);
    expect(result.content).toEqual(["He goes home."]);
    expect(result.promptTokens).toBe(12);
    expect(result.completionTokens).toBe(4);
  });

  it("fans n > 1 out into separate calls and resolves the model from the first", async () => {
    generateTextMock.mockImplementation(
      fakeGenerateText([
        { text: "first", usage: { inputTokens: 10, outputTokens: 2 }, body: { model: SERVED_MODEL } },
        { text: "second", usage: { inputTokens: 10, outputTokens: 3 }, body: { model: "other" } },
      ]),
    );

    const result = await request({ n: 2 });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    for (const [options] of generateTextMock.mock.calls) {
      expect(options.include).toEqual({ responseBody: true });
    }
    expect(result.content).toEqual(["first", "second"]);
    expect(result.resolvedModel).toBe(SERVED_MODEL);
    expect(result.promptTokens).toBe(20);
    expect(result.completionTokens).toBe(5);
  });

  it("falls back to the requested id when the body names no model", async () => {
    generateTextMock.mockImplementation(fakeGenerateText({ text: "ok", body: {} }));

    const result = await request();

    expect(result.resolvedModel).toBe(REQUESTED_MODEL);
  });
});
