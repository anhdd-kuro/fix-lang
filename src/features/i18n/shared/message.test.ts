/**
 * @file message.test.ts
 * @description Unit tests for the locale-free `Message`/`Label` descriptors
 * (Chunk 8). `resolveMessage`/`resolveLabel` are tested against a fake
 * `Translate` so this file has no dependency on the real catalogs — it only
 * proves the descriptor shapes and the dispatch logic, not translation
 * content (that belongs to `translate.test.ts` and the view-module tests).
 */
import { describe, expect, it } from "vitest";
import {
  messageLabel,
  msg,
  resolveLabel,
  resolveMessage,
  textLabel,
  type Message,
  type Translate,
} from "./message";

/** Records every call so tests can assert both the return value and the forwarded args. */
const fakeTranslate = (): { t: Translate; calls: [string, unknown][] } => {
  const calls: [string, unknown][] = [];
  const t: Translate = (key, params) => {
    calls.push([key, params]);
    return params ? `${key}:${JSON.stringify(params)}` : key;
  };
  return { t, calls };
};

describe("msg", () => {
  it("omits params entirely when not provided", () => {
    expect(msg("common.save")).toEqual({ key: "common.save" });
  });

  it("carries params when provided", () => {
    expect(msg("overview.value.days", { count: 3 })).toEqual({
      key: "overview.value.days",
      params: { count: 3 },
    });
  });
});

describe("textLabel", () => {
  it("wraps verbatim text with kind 'text'", () => {
    expect(textLabel("gpt-4o")).toEqual({ kind: "text", text: "gpt-4o" });
  });
});

describe("messageLabel", () => {
  it("wraps a key (no params) with kind 'message'", () => {
    expect(messageLabel("overview.preset.untitled")).toEqual({
      kind: "message",
      message: { key: "overview.preset.untitled" },
    });
  });

  it("wraps a key + params with kind 'message'", () => {
    expect(messageLabel("models.table.showMore", { count: 5 })).toEqual({
      kind: "message",
      message: { key: "models.table.showMore", params: { count: 5 } },
    });
  });
});

describe("resolveMessage", () => {
  it("forwards key and params to the translate function", () => {
    const { t, calls } = fakeTranslate();
    const message: Message = { key: "overview.value.days", params: { count: 2 } };
    const result = resolveMessage(message, t);
    expect(calls).toEqual([["overview.value.days", { count: 2 }]]);
    expect(result).toBe('overview.value.days:{"count":2}');
  });

  it("forwards undefined params when the message has none", () => {
    const { t, calls } = fakeTranslate();
    resolveMessage({ key: "common.save" }, t);
    expect(calls).toEqual([["common.save", undefined]]);
  });
});

describe("resolveLabel", () => {
  it("returns the verbatim text for a 'text' label without calling translate", () => {
    const { t, calls } = fakeTranslate();
    const result = resolveLabel(textLabel("Correction"), t);
    expect(result).toBe("Correction");
    expect(calls).toEqual([]);
  });

  it("resolves a 'message' label through translate", () => {
    const { t, calls } = fakeTranslate();
    const result = resolveLabel(messageLabel("overview.preset.untitled"), t);
    expect(calls).toEqual([["overview.preset.untitled", undefined]]);
    expect(result).toBe("overview.preset.untitled");
  });

  it("resolves a 'message' label with params through translate", () => {
    const { t } = fakeTranslate();
    const result = resolveLabel(
      messageLabel("models.table.showMore", { count: 7 }),
      t,
    );
    expect(result).toBe('models.table.showMore:{"count":7}');
  });
});
