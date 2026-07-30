import { describe, expect, it } from "vitest";
import {
  displayHistoryMessageContent,
  formatHistorySessionJson,
  historyChatMessages,
  historyChatSessionMeta,
  reasoningEffortDisplayKey,
} from "./historySessionDetailsView";

const legacySession = JSON.stringify({
  systemPrompt: "System prompt",
  userPrompt: "User prompt",
  messages: [
    { role: "system", content: "System prompt" },
    { role: "user", content: "User prompt" },
  ],
  model: "gpt-4.1-mini",
  provider: "openai",
  responses: ["Assistant response"],
  promptTokens: 10,
  completionTokens: 2,
});

describe("historySessionDetailsView", () => {
  it("shows each prompt once in normalized JSON and chat messages", () => {
    const formatted = JSON.parse(formatHistorySessionJson(legacySession));

    expect(formatted).not.toHaveProperty("systemPrompt");
    expect(formatted).not.toHaveProperty("userPrompt");
    expect(historyChatMessages(legacySession)).toEqual([
      { role: "system", content: "System prompt" },
      { role: "user", content: "User prompt" },
      { role: "assistant", content: "Assistant response" },
    ]);
  });


  it("extracts chat session metadata", () => {
    const withEffort = JSON.stringify({
      messages: [{ role: "user", content: "Hi" }],
      model: "gpt-4.1-mini",
      provider: "openai",
      responses: ["Hello"],
      promptTokens: 10,
      completionTokens: 2,
      reasoningEffort: "low",
    });

    expect(historyChatSessionMeta(withEffort)).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      reasoningEffort: "low",
    });
    expect(reasoningEffortDisplayKey("low")).toBe(
      "settings.correction.reasoning.step.low",
    );
    expect(reasoningEffortDisplayKey("provider-default")).toBe(
      "history.details.reasoning.providerDefault",
    );
  });

  it("formats structured message content for chat", () => {
    expect(displayHistoryMessageContent({ text: "hello" })).toBe(
      '{\n  "text": "hello"\n}',
    );
  });
});
