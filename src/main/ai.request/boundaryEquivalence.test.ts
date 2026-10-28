/**
 * Pins how the provider-response readers treat whatever an SDK hands back —
 * usage counts, cache usage, the served model id, and message content — across
 * the edge inputs a hand-rolled `typeof` guard and a schema library disagree on
 * by default: NaN, ±Infinity, -0, boxed primitives, arrays, functions, class
 * instances and inherited properties. Written against the `typeof` readers
 * before they were replaced, so a parser swap that changes one reading fails
 * here.
 */
import { describe, expect, it } from "vitest";
import {
  buildCachedMessages,
  CacheProvider,
  extractCacheUsage,
} from "./cache-strategy";
import { toConversation, usageCounts } from "./requestTypes";
import { extractResolvedModel } from "./resolve-model";

const OUTPUT_TOKENS = 3;

class Usage {
  inputTokens = 7;
  // A prototype getter, not an own field: readers must see inherited values.
  get outputTokens() {
    return OUTPUT_TOKENS;
  }
}

const VALUE_EDGES = [
  ["number", 5],
  ["zero", 0],
  ["-0", -0],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["boxed number", new Number(5)],
  ["string", "5"],
  ["null", null],
  ["undefined", undefined],
  ["boolean", true],
  ["array", [5]],
] as const;

const CONTAINER_EDGES = [
  ["null", null],
  ["undefined", undefined],
  ["zero", 0],
  ["empty string", ""],
  ["string", "usage"],
  ["function", () => 5],
  ["empty object", {}],
  ["class instance", new Usage()],
  ["inherited fields", Object.create({ inputTokens: 2, model: "proto/model" })],
] as const;

describe("provider response readers equivalence", () => {
  describe("usageCounts", () => {
    it.each(
      [
        "promptTokens",
        "inputTokens",
        "completionTokens",
        "outputTokens",
      ].flatMap((field) =>
        VALUE_EDGES.map(([label, value]) => [field, label, value] as const),
      ),
    )("%s = %s", (field, _label, value) => {
      expect(usageCounts({ [field]: value })).toMatchSnapshot("verdict");
    });

    it.each([
      ["primary wins", { promptTokens: 1, inputTokens: 2 }],
      ["null primary falls back", { promptTokens: null, inputTokens: 2 }],
      [
        "junk primary does not fall back",
        { promptTokens: "1", inputTokens: 2 },
      ],
      ["NaN primary does not fall back", { promptTokens: NaN, inputTokens: 2 }],
      ["array carrying the fields", Object.assign([], { inputTokens: 4 })],
      ...CONTAINER_EDGES,
    ] as const)("%s", (_label, usage) => {
      expect(usageCounts(usage)).toMatchSnapshot("verdict");
    });
  });

  describe("extractCacheUsage", () => {
    it.each(
      ["cache_read_input_tokens", "cache_creation_input_tokens"].flatMap(
        (field) =>
          VALUE_EDGES.map(([label, value]) => [field, label, value] as const),
      ),
    )("%s = %s", (field, _label, value) => {
      expect(extractCacheUsage({ [field]: value })).toMatchSnapshot("verdict");
    });

    it.each([
      [
        "array carrying the fields",
        Object.assign([], { cache_read_input_tokens: 4 }),
      ],
      ...CONTAINER_EDGES,
    ] as const)("%s", (_label, usage) => {
      expect(extractCacheUsage(usage)).toMatchSnapshot("verdict");
    });
  });

  describe("extractResolvedModel", () => {
    it.each([
      ["string", "served/model"],
      ["padded", "  served/model  "],
      ["blank", "   "],
      ["empty", ""],
      ["boxed", new String("served/model")],
      ["number", 4],
      ["null", null],
      ["undefined", undefined],
      ["array", ["served/model"]],
    ] as const)("model = %s", (_label, model) => {
      expect(extractResolvedModel({ model }, "fallback")).toMatchSnapshot(
        "verdict",
      );
    });

    it.each([
      [
        "array carrying the field",
        Object.assign([], { model: "served/model" }),
      ],
      [
        "function carrying the field",
        Object.assign(() => 1, { model: "served/model" }),
      ],
      ...CONTAINER_EDGES,
    ] as const)("%s", (_label, body) => {
      expect(extractResolvedModel(body, "fallback")).toMatchSnapshot("verdict");
    });
  });

  describe("message content", () => {
    it.each([
      ["string", "text"],
      ["boxed string", new String("text")],
      ["blocks", [{ type: "text", text: "t" }]],
      ["object", { text: "t" }],
      ["number", 4],
      ["null", null],
    ] as const)("%s", (_label, content) => {
      expect({
        conversation: toConversation([
          { role: "system", content },
          { role: "user", content: "u" },
        ]).system,
        cached: buildCachedMessages(
          [{ role: "system", content }],
          CacheProvider.ANTHROPIC,
        ),
      }).toMatchSnapshot("verdict");
    });
  });
});
