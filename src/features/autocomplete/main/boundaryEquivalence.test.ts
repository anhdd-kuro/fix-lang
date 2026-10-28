/**
 * Pins what the autocomplete main-process boundary accepts and rejects across
 * the edge inputs a hand-rolled `typeof` guard and a schema library disagree on
 * by default: NaN, ±Infinity, -0, arrays, null, functions, boxed primitives,
 * class instances, extra keys and missing keys. Written against the `typeof`
 * guards before they were replaced, so a parser swap that changes a single
 * verdict, fallback or forwarded field fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAutocompleteSettings } from "~/features/autocomplete/shared/autocompleteSettings";
import { registerAutocompleteHandlers } from "./ipc";
import { parseAutocompleteReply } from "./parseReply";
import { sanitizeSuggestion } from "./sanitize";
import { registerAutocompleteSettingsHandlers } from "./settings";
import type { ipcMain } from "electron";

const { electronMocks, serviceMocks, apiStoreMocks, loggerMock } = vi.hoisted(
  () => ({
    electronMocks: { handle: vi.fn(), on: vi.fn() },
    serviceMocks: {
      requestAutocompleteSuggestion: vi.fn(),
      takeAutocompleteResolution: vi.fn(),
    },
    apiStoreMocks: {
      getProfileSetting: vi.fn(),
      updateProfileSetting: vi.fn(),
    },
    loggerMock: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }),
);

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle, on: electronMocks.on },
}));
vi.mock("~/features/autocomplete/main/service", () => serviceMocks);
vi.mock("~/features/autocomplete/store/autocompleteUsageStore", () => ({
  autocompleteUsageStore: {
    getDay: vi.fn(() => null),
    getMonth: vi.fn(() => null),
    getDays: vi.fn(() => []),
  },
}));
vi.mock("~/features/providers/store/apiStore", () => apiStoreMocks);
vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

/**
 * Electron types every IPC argument and reply as `any`, and these tests feed the
 * handlers deliberately malformed payloads, so Electron's own wire type is the
 * honest one for them.
 */
type IpcWireValue = Parameters<Parameters<typeof ipcMain.handle>[1]>[1];
type Handler = (
  event: { sender: { id: number } },
  raw?: IpcWireValue,
) => IpcWireValue;

const registered = (
  mock: typeof electronMocks.handle,
  channel: string,
): Handler => {
  const call = mock.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`nothing registered for "${channel}"`);
  return call[1];
};

const EVENT = { sender: { id: 1 } };

class Box {
  enabled = true;
  model = "m";
  dailyCostCapUsd = 5;
  requestId = 4;
  prefix = "hello there";
  reason = "composing";
  prefixLength = 3;
  suppressedSincePrevious = 1;
}

/** Values every field below is tried with. */
const FIELD_EDGES = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["-0", -0],
  ["fraction", 2.7],
  ["negative", -3],
  ["huge", 1e308],
  ["boxed number", new Number(4)],
  ["string", "4"],
  ["boxed string", new String("4")],
  ["empty string", ""],
  ["boolean", true],
  ["null", null],
  ["undefined", undefined],
  ["array", [4]],
  ["object", { n: 4 }],
  ["function", () => 4],
] as const;

/** Whole-payload shapes every handler below is tried with. */
const PAYLOAD_EDGES = [
  ["null", null],
  ["undefined", undefined],
  ["string", "payload"],
  ["number", 7],
  ["function", () => 1],
  ["empty array", []],
  ["empty object", {}],
  ["class instance", new Box()],
  ["boxed string", new String("payload")],
] as const;

describe("autocomplete main boundary equivalence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAutocompleteHandlers();
    registerAutocompleteSettingsHandlers();
    serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({
      requestId: 0,
      suggestion: null,
    });
    apiStoreMocks.updateProfileSetting.mockReturnValue({ success: true });
  });

  describe("set-autocomplete-settings", () => {
    const valid = { enabled: true, model: "m", dailyCostCapUsd: 5 };
    const fields = ["enabled", "model", "dailyCostCapUsd"] as const;

    it.each(
      fields.flatMap((field) =>
        FIELD_EDGES.map(
          ([label, value]) =>
            [field, label, { ...valid, [field]: value }] as const,
        ),
      ),
    )("%s = %s", async (_field, _label, payload) => {
      const reply = await registered(
        electronMocks.handle,
        "set-autocomplete-settings",
      )(EVENT, payload);
      expect({
        reply,
        written: apiStoreMocks.updateProfileSetting.mock.calls[0]?.[1],
      }).toMatchSnapshot("verdict");
    });

    it.each([
      ...PAYLOAD_EDGES,
      ["valid", valid],
      ["extra key", { ...valid, extra: "x" }],
      ["missing key", { enabled: true, model: "m" }],
      ["array carrying the fields", Object.assign([], valid)],
    ] as const)("payload %s", async (_label, payload) => {
      const reply = await registered(
        electronMocks.handle,
        "set-autocomplete-settings",
      )(EVENT, payload);
      expect({
        reply,
        written: apiStoreMocks.updateProfileSetting.mock.calls[0]?.[1],
      }).toMatchSnapshot("verdict");
    });
  });

  describe("autocomplete-suggest", () => {
    const valid = { requestId: 4, prefix: "hello there", suffix: " end" };
    const fields = ["requestId", "prefix", "suffix"] as const;

    it.each(
      fields.flatMap((field) =>
        FIELD_EDGES.map(
          ([label, value]) =>
            [field, label, { ...valid, [field]: value }] as const,
        ),
      ),
    )("%s = %s", async (_field, _label, payload) => {
      await registered(electronMocks.handle, "autocomplete-suggest")(
        EVENT,
        payload,
      );
      const request =
        serviceMocks.requestAutocompleteSuggestion.mock.calls[0]?.[0];
      expect({ keys: Object.keys(request), request }).toMatchSnapshot(
        "verdict",
      );
    });

    it.each([
      ...PAYLOAD_EDGES,
      ["valid", valid],
      ["extra key", { ...valid, sessionId: "spoofed", extra: 1 }],
      ["array carrying the fields", Object.assign([], valid)],
    ] as const)("payload %s", async (_label, payload) => {
      await registered(electronMocks.handle, "autocomplete-suggest")(
        EVENT,
        payload,
      );
      const request =
        serviceMocks.requestAutocompleteSuggestion.mock.calls[0]?.[0];
      expect({ keys: Object.keys(request), request }).toMatchSnapshot(
        "verdict",
      );
    });
  });

  describe("autocomplete-skip", () => {
    const valid = {
      reason: "composing",
      prefixLength: 3,
      suppressedSincePrevious: 1,
      requestId: 4,
    };
    const fields = [
      "reason",
      "prefixLength",
      "suppressedSincePrevious",
      "requestId",
    ] as const;

    const logged = () => ({
      debug: loggerMock.debug.mock.calls.map((call) => call[2]),
      resolutionLookups:
        serviceMocks.takeAutocompleteResolution.mock.calls.length,
    });

    it.each(
      fields.flatMap((field) =>
        FIELD_EDGES.map(
          ([label, value]) =>
            [field, label, { ...valid, [field]: value }] as const,
        ),
      ),
    )("%s = %s", (_field, _label, payload) => {
      registered(electronMocks.on, "autocomplete-skip")(EVENT, payload);
      expect(logged()).toMatchSnapshot("verdict");
    });

    it.each([
      ...PAYLOAD_EDGES,
      ["valid", valid],
      ["late reply", { ...valid, reason: "reply-too-late" }],
      ["boxed reason", { ...valid, reason: new String("composing") }],
      ["extra key", { ...valid, prefix: "typed text" }],
      ["array carrying the fields", Object.assign([], valid)],
    ] as const)("payload %s", (_label, payload) => {
      serviceMocks.takeAutocompleteResolution.mockReturnValue(null);
      registered(electronMocks.on, "autocomplete-skip")(EVENT, payload);
      expect(logged()).toMatchSnapshot("verdict");
    });
  });

  describe("normalizeAutocompleteSettings", () => {
    const valid = { enabled: true, model: " m ", dailyCostCapUsd: 5 };
    const fields = ["enabled", "model", "dailyCostCapUsd"] as const;

    it.each(
      fields.flatMap((field) =>
        FIELD_EDGES.map(
          ([label, value]) =>
            [field, label, { ...valid, [field]: value }] as const,
        ),
      ),
    )("%s = %s", (_field, _label, raw) => {
      expect(normalizeAutocompleteSettings(raw)).toMatchSnapshot("verdict");
    });

    it.each([
      ...PAYLOAD_EDGES,
      ["valid", valid],
      ["extra key", { ...valid, extra: 1 }],
      ["array carrying the fields", Object.assign([], valid)],
      ["boxed true", { enabled: new Boolean(true) }],
    ] as const)("payload %s", (_label, raw) => {
      expect(normalizeAutocompleteSettings(raw)).toMatchSnapshot("verdict");
    });
  });

  describe("parseAutocompleteReply and sanitizeSuggestion", () => {
    it.each([
      ["object", '{"suggestion":" tail"}'],
      ["array", '[" tail"]'],
      ["array with field", '[{"suggestion":" tail"}]'],
      ["number", "4"],
      ["string", '" tail"'],
      ["null", "null"],
      ["null field", '{"suggestion":null}'],
      ["numeric field", '{"suggestion":4}'],
      ["inherited-looking key", '{"__proto__":{"suggestion":" tail"}}'],
      ["boxed reply", new String('{"suggestion":" tail"}')],
      ["number reply", 4],
      ["undefined reply", undefined],
      ["array reply", ['{"suggestion":" tail"}']],
    ] as const)("%s", (_label, raw) => {
      expect(parseAutocompleteReply(raw)).toMatchSnapshot("verdict");
    });

    it.each([
      ["string", " tail"],
      ["boxed string", new String(" tail")],
      ["number", 4],
      ["null", null],
      ["undefined", undefined],
      ["array", [" tail"]],
    ] as const)("sanitize %s", (_label, raw) => {
      expect(sanitizeSuggestion(raw, "")).toMatchSnapshot("verdict");
    });
  });
});
