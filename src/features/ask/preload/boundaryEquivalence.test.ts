/**
 * Pins which Ask payloads the preload bridge hands to the window, across the
 * edge inputs a hand-rolled `typeof`/`in` guard and a schema library disagree
 * on by default: optional keys PRESENT but `undefined` (the old `in` check
 * rejected them), arrays and class instances carrying the fields, boxed
 * strings, extra keys and missing keys. Written against the `typeof` guards
 * before they were replaced, so a parser swap that changes one verdict fails
 * here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askFeature } from "./ask";
import type { ipcRenderer } from "electron";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({ ipcRenderer: electronMocks }));

/**
 * Electron types every IPC payload as `any`, and these tests send deliberately
 * malformed ones, so Electron's own wire type is the honest one for them.
 */
type IpcWireValue = Parameters<Parameters<typeof ipcRenderer.on>[1]>[1];
type Listener = (event: undefined, payload: IpcWireValue) => void;

const deliver = (
  subscribe: (callback: (payload: IpcWireValue) => void) => () => void,
  payload: IpcWireValue,
) => {
  const callback = vi.fn();
  subscribe(callback);
  const listener: Listener = electronMocks.on.mock.calls[0][1];
  listener(undefined, payload);
  // Spread, so an accepted array and an accepted object with the same fields
  // compare equal: the verdict and the fields are pinned, not the container.
  return callback.mock.calls.map(([delivered]) => ({ ...delivered }));
};

class AskInput {
  presetId = "ask";
  context = "ctx";
}

const FIELD_EDGES = [
  ["undefined", undefined],
  ["null", null],
  ["empty string", ""],
  ["boxed string", new String("x")],
  ["number", 4],
  ["NaN", NaN],
  ["boolean", true],
  ["array", ["x"]],
  ["object", { x: 1 }],
  ["function", () => "x"],
] as const;

const PAYLOAD_EDGES = [
  ["null", null],
  ["undefined", undefined],
  ["string", "payload"],
  ["number", 7],
  ["function", () => 1],
  ["empty array", []],
  ["empty object", {}],
  ["boxed string", new String("payload")],
] as const;

describe("ask preload boundary equivalence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ask-input-data", () => {
    const valid = {
      presetId: "ask",
      context: "selected text",
      contextSource: "selection",
      systemPrompt: "system",
      contextDirectives: "directives",
    };
    const fields = [
      "presetId",
      "context",
      "contextSource",
      "systemPrompt",
      "contextDirectives",
    ] as const;

    it.each(
      fields.flatMap((field) =>
        FIELD_EDGES.map(
          ([label, value]) =>
            [field, label, { ...valid, [field]: value }] as const,
        ),
      ),
    )("%s = %s", (_field, _label, payload) => {
      expect(deliver(askFeature.onAskInputData, payload)).toMatchSnapshot(
        "verdict",
      );
    });

    it.each(fields)("%s missing", (field) => {
      const payload = Object.fromEntries(
        Object.entries(valid).filter(([key]) => key !== field),
      );
      expect(deliver(askFeature.onAskInputData, payload)).toMatchSnapshot(
        "verdict",
      );
    });

    it.each([
      ...PAYLOAD_EDGES,
      ["valid", valid],
      ["clipboard source", { ...valid, contextSource: "clipboard" }],
      ["unknown source", { ...valid, contextSource: "other" }],
      ["extra key", { ...valid, extra: 1 }],
      ["class instance", new AskInput()],
      ["array carrying the fields", Object.assign([], valid)],
    ] as const)("payload %s", (_label, payload) => {
      expect(deliver(askFeature.onAskInputData, payload)).toMatchSnapshot(
        "verdict",
      );
    });
  });

  describe("ask-result-data", () => {
    const valid = {
      question: "q",
      answer: "a",
      markdown: true,
      presetName: "Ask",
      input: "selection",
    };
    const fields = [
      "question",
      "answer",
      "markdown",
      "presetName",
      "input",
    ] as const;

    it.each(
      fields.flatMap((field) =>
        FIELD_EDGES.map(
          ([label, value]) =>
            [field, label, { ...valid, [field]: value }] as const,
        ),
      ),
    )("%s = %s", (_field, _label, payload) => {
      expect(deliver(askFeature.onAskResultData, payload)).toMatchSnapshot(
        "verdict",
      );
    });

    it.each(fields)("%s missing", (field) => {
      const payload = Object.fromEntries(
        Object.entries(valid).filter(([key]) => key !== field),
      );
      expect(deliver(askFeature.onAskResultData, payload)).toMatchSnapshot(
        "verdict",
      );
    });

    it.each([
      ...PAYLOAD_EDGES,
      ["valid", valid],
      ["boxed markdown", { ...valid, markdown: new Boolean(true) }],
      ["extra key", { ...valid, extra: 1 }],
      ["array carrying the fields", Object.assign([], valid)],
    ] as const)("payload %s", (_label, payload) => {
      expect(deliver(askFeature.onAskResultData, payload)).toMatchSnapshot(
        "verdict",
      );
    });
  });
});
