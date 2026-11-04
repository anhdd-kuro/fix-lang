/**
 * Pins what the autocomplete preload bridges accept and reject at the IPC
 * boundary, across the edge inputs a hand-rolled `typeof` guard and a schema
 * library disagree on by default: NaN, ±Infinity, -0, arrays, null, functions,
 * boxed primitives, class instances, extra keys and missing keys. Written
 * against the `typeof` guards before they were replaced, so a parser swap that
 * changes a single verdict fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { autocompleteFeature } from "./autocomplete";
import { autocompleteSettingsFeature } from "./autocompleteSettings";
import type { ipcRenderer } from "electron";
import type { AutocompleteSettings } from "~/features/autocomplete/shared/autocompleteSettings";
import type { AutocompleteUsageSnapshot } from "~/features/autocomplete/shared/autocompleteWire";

const electronMocks = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn() }));

vi.mock("electron", () => ({ ipcRenderer: electronMocks }));

/**
 * Electron types every invoke reply as `any`, and these tests reply with
 * deliberately malformed ones, so Electron's own wire type is the honest one.
 */
type IpcWireValue = Awaited<ReturnType<typeof ipcRenderer.invoke>>;
type UsageSnapshotProbe = Partial<
  Record<keyof AutocompleteUsageSnapshot | "extra", IpcWireValue>
>;

class Settings {
  enabled = true;
  model = "openai::gpt-5";
  dailyCostCapUsd = 5;
}

const ROLLUP_DATE = "2026-07-31";

class GetterRollup {
  // A prototype getter, not an own field: readers must see inherited values.
  get date() {
    return ROLLUP_DATE;
  }
}

const rollup = {
  date: "2026-07-31",
  requests: 3,
  responses: 3,
  tokenlessResponses: 0,
  unpricedResponses: 1,
  promptTokens: 40,
  completionTokens: 12,
  estimatedCostUsd: 0.02,
};

const SETTINGS_EDGES = [
  ["valid", { enabled: true, model: "m", dailyCostCapUsd: 5 }],
  ["extra key", { enabled: true, model: "m", dailyCostCapUsd: 5, extra: 1 }],
  ["negative zero cap", { enabled: false, model: "", dailyCostCapUsd: -0 }],
  ["NaN cap", { enabled: true, model: "m", dailyCostCapUsd: NaN }],
  ["Infinity cap", { enabled: true, model: "m", dailyCostCapUsd: Infinity }],
  ["-Infinity cap", { enabled: true, model: "m", dailyCostCapUsd: -Infinity }],
  ["boxed cap", { enabled: true, model: "m", dailyCostCapUsd: new Number(5) }],
  [
    "boxed model",
    { enabled: true, model: new String("m"), dailyCostCapUsd: 5 },
  ],
  [
    "boxed enabled",
    { enabled: new Boolean(true), model: "", dailyCostCapUsd: 5 },
  ],
  ["missing enabled", { model: "m", dailyCostCapUsd: 5 }],
  ["undefined enabled", { enabled: undefined, model: "m", dailyCostCapUsd: 5 }],
  ["class instance", new Settings()],
  ["array", []],
  [
    "array carrying the fields",
    Object.assign([], { enabled: true, model: "m", dailyCostCapUsd: 5 }),
  ],
  ["function", () => 1],
  ["null", null],
  ["undefined", undefined],
  ["string", "settings"],
] as const;

describe("autocomplete preload boundary equivalence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(SETTINGS_EDGES)(
    "getAutocompleteSettings: %s",
    async (_label, reply) => {
      electronMocks.invoke.mockResolvedValue(reply);
      const result =
        await autocompleteSettingsFeature.getAutocompleteSettings();
      // Spread, so an accepted array and an accepted object with the same fields
      // compare equal: the verdict and the fields are pinned, not the container.
      expect({ ...result }).toMatchSnapshot("verdict");
    },
  );

  it.each(SETTINGS_EDGES)(
    "setAutocompleteSettings: %s",
    async (_label, payload) => {
      electronMocks.invoke.mockResolvedValue({ success: true });
      const result = await autocompleteSettingsFeature.setAutocompleteSettings(
        // The edges are deliberately not settings; the bridge must refuse them.
        payload as AutocompleteSettings,
      );
      expect({
        result,
        sent: electronMocks.invoke.mock.calls[0]?.[1] === payload,
      }).toMatchSnapshot("verdict");
    },
  );

  it.each([
    ["valid", { requestId: 3, suggestion: " tail" }],
    ["null suggestion", { requestId: 3, suggestion: null }],
    ["extra key", { requestId: 3, suggestion: "x", extra: true }],
    ["NaN id", { requestId: NaN, suggestion: "x" }],
    ["Infinity id", { requestId: Infinity, suggestion: "x" }],
    ["-0 id", { requestId: -0, suggestion: "x" }],
    ["boxed id", { requestId: new Number(3), suggestion: "x" }],
    ["boxed suggestion", { requestId: 3, suggestion: new String("x") }],
    ["missing suggestion", { requestId: 3 }],
    ["undefined suggestion", { requestId: 3, suggestion: undefined }],
    ["numeric suggestion", { requestId: 3, suggestion: 4 }],
    ["missing id", { suggestion: "x" }],
    ["array", Object.assign([], { requestId: 3, suggestion: "x" })],
    ["function", () => 1],
    ["null", null],
    ["string", "reply"],
  ] as const)("requestAutocompleteSuggestion: %s", async (_label, reply) => {
    electronMocks.invoke.mockResolvedValue(reply);
    const result = await autocompleteFeature.requestAutocompleteSuggestion({
      requestId: 9,
      prefix: "hello",
    });
    // Spread, so an accepted array and an accepted object with the same fields
    // compare equal: the verdict and the fields are pinned, not the container.
    expect({ ...result }).toMatchSnapshot("verdict");
  });

  it("requestAutocompleteSuggestion: a rejected invoke", async () => {
    electronMocks.invoke.mockRejectedValue(new Error("boom"));
    expect(
      await autocompleteFeature.requestAutocompleteSuggestion({
        requestId: 9,
        prefix: "hello",
      }),
    ).toEqual({ requestId: 9, suggestion: null });
  });

  const snapshot = (overrides: UsageSnapshotProbe) => ({
    today: rollup,
    month: rollup,
    days: [rollup],
    dailyCostCapUsd: 5,
    ...overrides,
  });

  it.each([
    ["valid", snapshot({})],
    ["extra key", snapshot({ extra: 1 })],
    ["NaN cap", snapshot({ dailyCostCapUsd: NaN })],
    ["Infinity cap", snapshot({ dailyCostCapUsd: Infinity })],
    ["boxed cap", snapshot({ dailyCostCapUsd: new Number(5) })],
    ["NaN in a rollup", snapshot({ today: { ...rollup, requests: NaN } })],
    [
      "Infinity in a rollup",
      snapshot({ month: { ...rollup, estimatedCostUsd: Infinity } }),
    ],
    ["-0 in a rollup", snapshot({ today: { ...rollup, promptTokens: -0 } })],
    ["extra key in a rollup", snapshot({ today: { ...rollup, extra: "x" } })],
    [
      "missing counter in a rollup",
      snapshot({ today: { ...rollup, responses: undefined } }),
    ],
    ["boxed date", snapshot({ today: { ...rollup, date: new String("d") } })],
    ["class rollup", snapshot({ today: new GetterRollup() })],
    ["array rollup", snapshot({ today: Object.assign([], rollup) })],
    ["empty days", snapshot({ days: [] })],
    ["days not an array", snapshot({ days: { 0: rollup } })],
    ["bad day", snapshot({ days: [rollup, { ...rollup, requests: "3" }] })],
    ["missing today", snapshot({ today: undefined })],
    ["array", Object.assign([], snapshot({}))],
    ["null", null],
    ["string", "usage"],
  ] as const)("getAutocompleteUsage: %s", async (_label, reply) => {
    electronMocks.invoke.mockResolvedValue(reply);
    const result = await autocompleteFeature.getAutocompleteUsage();
    // Spread, so an accepted array and an accepted object with the same fields
    // compare equal: the verdict and the fields are pinned, not the container.
    expect({ ...result }).toMatchSnapshot("verdict");
  });
});
