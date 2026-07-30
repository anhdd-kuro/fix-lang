/**
 * @file historySession.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  parseHistorySession,
  serializeHistorySession,
  type HistorySessionData,
} from "./historySession";

const sample = (): HistorySessionData => ({
  messages: [
    { role: "system", content: "Fix grammar." },
    { role: "user", content: "Input:\nhello" },
  ],
  reasoningEffort: "low",
  topP: 1,
  model: "gpt-4.1-mini",
  provider: "openai",
  resolvedModel: "gpt-4.1-mini-2025-04-14",
  responses: ["Hello"],
  reasoningTexts: ["think"],
  promptTokens: 10,
  completionTokens: 2,
});

describe("historySession", () => {
  it("round-trips through JSON", () => {
    const json = serializeHistorySession(sample());
    expect(parseHistorySession(json)).toEqual(sample());
  });

  it("normalizes legacy prompt fields out of the JSON snapshot", () => {
    const legacy = JSON.stringify({
      ...sample(),
      systemPrompt: "Fix grammar.",
      userPrompt: "Input:\nhello",
    });

    const session = parseHistorySession(legacy);
    if (!session) throw new Error("Expected legacy session to parse");
    expect(session).toEqual(sample());
    expect(JSON.parse(serializeHistorySession(session))).not.toHaveProperty(
      "systemPrompt",
    );
    expect(JSON.parse(serializeHistorySession(session))).not.toHaveProperty(
      "userPrompt",
    );
  });

  it("returns undefined for empty or corrupt payloads", () => {
    expect(parseHistorySession(undefined)).toBeUndefined();
    expect(parseHistorySession("")).toBeUndefined();
    expect(parseHistorySession("{")).toBeUndefined();
    expect(parseHistorySession("{}")).toBeUndefined();
  });
});
