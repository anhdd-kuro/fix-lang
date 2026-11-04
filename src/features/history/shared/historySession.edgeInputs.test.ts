/**
 * @file historySession.edgeInputs.test.ts
 * @description Pins `parseHistorySession` on stored JSON at its edges: a
 * required field that is wrong rejects the whole snapshot, an optional one is
 * dropped on its own, `1e999` parses to Infinity and still counts as a
 * number, and the result's keys come out in one fixed order.
 */
import { describe, expect, it } from "vitest";
import { parseHistorySession } from "./historySession";

const base = {
  messages: [{ role: "user", content: "hi" }],
  model: "m",
  provider: "openai",
  responses: ["ok"],
  promptTokens: 1,
  completionTokens: 2,
};

/** A stored JSON value; `undefined` drops the key when stringified. */
type StoredJson =
  | string
  | number
  | boolean
  | null
  | undefined
  | StoredJson[]
  | { [key: string]: StoredJson };

const parse = (
  fields: Record<string, StoredJson>,
): ReturnType<typeof parseHistorySession> =>
  parseHistorySession(JSON.stringify({ ...base, ...fields }));

describe("parseHistorySession — edge inputs", () => {
  it.each([
    ["an array root", "[1]"],
    ["a string root", '"session"'],
    ["a null root", "null"],
    ["whitespace", "   \n"],
    ["truncated JSON", '{"model":'],
  ])("rejects %s", (_label, raw) => {
    expect(parseHistorySession(raw)).toBeUndefined();
  });

  it.each([
    ["a missing promptTokens", { promptTokens: undefined }],
    ["a string completionTokens", { completionTokens: "2" }],
    ["an unknown provider", { provider: "constructor" }],
    ["a non-string model", { model: 5 }],
    ["a non-array messages", { messages: { role: "user" } }],
    ["an array message", { messages: [["user"]] }],
    ["a message without a role", { messages: [{ content: "x" }] }],
    ["a null message", { messages: [null] }],
    ["a non-string response", { responses: ["ok", 1] }],
    ["a missing responses", { responses: undefined }],
  ])("rejects the whole snapshot for %s", (_label, fields) => {
    expect(parse(fields)).toBeUndefined();
  });

  it("accepts null token counts and Infinity from 1e999", () => {
    const raw = JSON.stringify({ ...base, promptTokens: null }).replace(
      '"completionTokens":2',
      '"completionTokens":1e999,"topP":-1e999,"cachedTokens":1e999',
    );
    const session = parseHistorySession(raw);
    expect(session?.promptTokens).toBeNull();
    expect(session?.completionTokens).toBe(Number.POSITIVE_INFINITY);
    expect(session?.topP).toBe(Number.NEGATIVE_INFINITY);
    expect(session?.cachedTokens).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps -0 as -0", () => {
    const session = parseHistorySession(
      JSON.stringify(base).replace('"promptTokens":1', '"promptTokens":-0'),
    );
    expect(Object.is(session?.promptTokens, -0)).toBe(true);
  });

  it("drops each invalid optional field on its own", () => {
    expect(
      parse({
        reasoningEffort: "ludicrous",
        topP: "1",
        resolvedModel: 7,
        reasoningTexts: ["a", 1],
        cachedTokens: null,
        cacheWriteTokens: "3",
      }),
    ).toEqual(base);
  });

  it("keeps a message's content even when absent, and drops its other keys", () => {
    const session = parse({
      messages: [{ role: "user" }, { role: "a", content: { x: 1 }, extra: 2 }],
    });
    expect(session?.messages).toEqual([
      { role: "user", content: undefined },
      { role: "a", content: { x: 1 } },
    ]);
    expect(Object.keys(session?.messages[0] ?? {})).toEqual([
      "role",
      "content",
    ]);
  });

  it("emits keys in one fixed order and ignores unknown ones", () => {
    const session = parseHistorySession(
      JSON.stringify({
        cacheWriteTokens: 4,
        unknown: true,
        cachedTokens: 3,
        reasoningTexts: ["t"],
        resolvedModel: "r",
        topP: 0.5,
        reasoningEffort: "low",
        completionTokens: 2,
        promptTokens: 1,
        responses: ["ok"],
        provider: "openai",
        model: "m",
        messages: [],
      }),
    );
    expect(Object.keys(session ?? {})).toEqual([
      "messages",
      "model",
      "provider",
      "responses",
      "promptTokens",
      "completionTokens",
      "reasoningEffort",
      "topP",
      "resolvedModel",
      "reasoningTexts",
      "cachedTokens",
      "cacheWriteTokens",
    ]);
  });
});
