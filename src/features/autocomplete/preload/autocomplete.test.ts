import { beforeEach, describe, expect, it, vi } from "vitest";
import { autocompleteFeature } from "./autocomplete";

const electronMocks = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn() }));

vi.mock("electron", () => ({ ipcRenderer: electronMocks }));

const validRollup = {
  date: "2026-07-31",
  requests: 3,
  responses: 3,
  tokenlessResponses: 0,
  unpricedResponses: 1,
  promptTokens: 40,
  completionTokens: 12,
  estimatedCostUsd: 0.02,
};

const zeroedRollup = {
  date: "",
  requests: 0,
  responses: 0,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
};

describe("autocomplete preload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * One-way on purpose: this runs on the typing path, so a round trip per
   * non-dispatch would cost more than the diagnostic is worth, and there is no
   * answer to wait for.
   */
  describe("reportAutocompleteSkip", () => {
    it("sends on the skip channel rather than invoking", () => {
      autocompleteFeature.reportAutocompleteSkip({
        reason: "caret-moved",
        prefixLength: 31,
        suppressedSincePrevious: 2,
      });

      expect(electronMocks.send).toHaveBeenCalledWith("autocomplete-skip", {
        reason: "caret-moved",
        prefixLength: 31,
        suppressedSincePrevious: 2,
      });
      expect(electronMocks.invoke).not.toHaveBeenCalled();
    });

    /**
     * Rebuilt field by field, never spread. A caller that grew an extra field
     * would otherwise put it on the wire and into an exportable log file
     * unnoticed — and on this feature the obvious extra field is the typed text.
     */
    it("puts only the three declared fields on the wire", () => {
      autocompleteFeature.reportAutocompleteSkip({
        reason: "prefix-too-short",
        prefixLength: 4,
        suppressedSincePrevious: 0,
        prefix: "my private unsent sentence",
      } as Parameters<typeof autocompleteFeature.reportAutocompleteSkip>[0]);

      const [, payload] = electronMocks.send.mock.calls[0] ?? [];
      expect(Object.keys(payload as object).sort()).toEqual([
        "prefixLength",
        "reason",
        "suppressedSincePrevious",
      ]);
      expect(JSON.stringify(payload)).not.toContain("private");
    });

    /**
     * `reply-too-late` needs a fourth field, because main can only name the
     * model that was slow if it can match the report to the reply it sent. An
     * ID, never a model name: a model id supplied by the renderer would be
     * renderer-controlled text in an exportable log file.
     */
    it("carries the reply id for a late arrival, and only for one", () => {
      autocompleteFeature.reportAutocompleteSkip({
        reason: "reply-too-late",
        prefixLength: 39,
        suppressedSincePrevious: 0,
        requestId: 12,
      });

      expect(electronMocks.send).toHaveBeenCalledWith("autocomplete-skip", {
        reason: "reply-too-late",
        prefixLength: 39,
        suppressedSincePrevious: 0,
        requestId: 12,
      });
    });

    it("omits requestId entirely when the reason does not carry one", () => {
      autocompleteFeature.reportAutocompleteSkip({
        reason: "composing",
        prefixLength: 9,
        suppressedSincePrevious: 0,
      });

      const [, payload] = electronMocks.send.mock.calls[0] ?? [];
      expect(Object.keys(payload as object)).not.toContain("requestId");
    });
  });

  describe("requestAutocompleteSuggestion", () => {
    it("invokes autocomplete-suggest with the request and returns a valid reply", async () => {
      electronMocks.invoke.mockResolvedValue({ requestId: 4, suggestion: "ghost text" });

      const reply = await autocompleteFeature.requestAutocompleteSuggestion({
        requestId: 4,
        prefix: "the quick brown fox",
      });

      expect(electronMocks.invoke).toHaveBeenCalledWith("autocomplete-suggest", {
        requestId: 4,
        prefix: "the quick brown fox",
      });
      expect(reply).toEqual({ requestId: 4, suggestion: "ghost text" });
    });

    it("accepts a null suggestion", async () => {
      electronMocks.invoke.mockResolvedValue({ requestId: 1, suggestion: null });

      const reply = await autocompleteFeature.requestAutocompleteSuggestion({
        requestId: 1,
        prefix: "twelve characters or more",
      });

      expect(reply).toEqual({ requestId: 1, suggestion: null });
    });

    it.each([
      undefined,
      null,
      "a string",
      { suggestion: "text" }, // missing requestId
      { requestId: "4", suggestion: "text" }, // non-number requestId
      { requestId: 4, suggestion: 42 }, // non-string, non-null suggestion
      { requestId: 4, suggestion: undefined }, // undefined is not string | null
      { requestId: 4 }, // missing suggestion entirely
    ])(
      "drops a malformed autocomplete-suggest reply and falls back to no suggestion: %j",
      async (reply) => {
        electronMocks.invoke.mockResolvedValue(reply);

        const result = await autocompleteFeature.requestAutocompleteSuggestion({
          requestId: 7,
          prefix: "twelve characters or more",
        });

        expect(result).toEqual({ requestId: 7, suggestion: null });
      },
    );

    /**
     * Shape validation says nothing about a promise that never produces a
     * value. An `invoke` that rejects — main throwing past its own handler —
     * reached React as an unhandled rejection once per keystroke, where the
     * honest outcome is simply no ghost text.
     */
    it("falls back to no suggestion when the invoke rejects", async () => {
      electronMocks.invoke.mockRejectedValue(new Error("No handler registered"));

      const result = autocompleteFeature.requestAutocompleteSuggestion({
        requestId: 3,
        prefix: "twelve characters or more",
      });

      await expect(result).resolves.toEqual({ requestId: 3, suggestion: null });
    });
  });

  describe("getAutocompleteUsage", () => {
    it("invokes autocomplete-usage and returns a valid snapshot", async () => {
      const snapshot = {
        today: validRollup,
        month: validRollup,
        days: [validRollup],
        dailyCostCapUsd: 1500,
      };
      electronMocks.invoke.mockResolvedValue(snapshot);

      const result = await autocompleteFeature.getAutocompleteUsage();

      expect(electronMocks.invoke).toHaveBeenCalledWith("autocomplete-usage");
      expect(result).toEqual(snapshot);
    });

    it.each([
      undefined,
      null,
      "a string",
      { today: validRollup, month: validRollup, days: [validRollup] }, // missing dailyCostCapUsd
      { today: validRollup, month: validRollup, days: [validRollup], dailyCostCapUsd: "1500" }, // non-number dailyCostCapUsd
      { today: { ...validRollup, requests: "3" }, month: validRollup, days: [], dailyCostCapUsd: 1500 }, // bad today field
      { today: validRollup, month: { ...validRollup, date: 42 }, days: [], dailyCostCapUsd: 1500 }, // bad month field
      { today: validRollup, month: validRollup, days: [{ ...validRollup, estimatedCostUsd: "0" }], dailyCostCapUsd: 1500 }, // bad day-series entry
      { today: validRollup, month: validRollup, days: "not an array", dailyCostCapUsd: 1500 }, // days not an array
      // Token counts land in the renderer's arithmetic. A string or a null
      // there is not a display bug, it is NaN in a total.
      { today: { ...validRollup, promptTokens: "40" }, month: validRollup, days: [], dailyCostCapUsd: 1500 },
      { today: { ...validRollup, completionTokens: null }, month: validRollup, days: [], dailyCostCapUsd: 1500 },
      { today: validRollup, month: { ...validRollup, promptTokens: null }, days: [], dailyCostCapUsd: 1500 },
      { today: validRollup, month: { ...validRollup, completionTokens: "12" }, days: [], dailyCostCapUsd: 1500 },
      {
        today: validRollup,
        month: validRollup,
        days: [{ ...validRollup, promptTokens: undefined }],
        dailyCostCapUsd: 1500,
      },
      // A rollup that is not an object at all. Without the object/null guard
      // the field reads below throw out of the bridge, and the renderer gets a
      // rejected promise instead of the zeroed fallback.
      { today: null, month: validRollup, days: [], dailyCostCapUsd: 1500 },
      { today: validRollup, month: null, days: [], dailyCostCapUsd: 1500 },
      { today: validRollup, month: validRollup, days: [null], dailyCostCapUsd: 1500 },
      { today: "2026-07-31", month: validRollup, days: [], dailyCostCapUsd: 1500 },
      // The coverage counters are the only thing standing between an
      // unpriceable day and a rendered "$0.00". A missing one reads as
      // `undefined`, every comparison against it is false, and the panel goes
      // back to fabricating the zero — so a rollup without them is malformed.
      { today: { ...validRollup, responses: undefined }, month: validRollup, days: [], dailyCostCapUsd: 1500 },
      { today: { ...validRollup, unpricedResponses: null }, month: validRollup, days: [], dailyCostCapUsd: 1500 },
      { today: { ...validRollup, tokenlessResponses: "0" }, month: validRollup, days: [], dailyCostCapUsd: 1500 },
      { today: validRollup, month: { ...validRollup, responses: "3" }, days: [], dailyCostCapUsd: 1500 },
      { today: validRollup, month: { ...validRollup, unpricedResponses: undefined }, days: [], dailyCostCapUsd: 1500 },
      { today: validRollup, month: { ...validRollup, tokenlessResponses: null }, days: [], dailyCostCapUsd: 1500 },
      {
        today: validRollup,
        month: validRollup,
        days: [{ ...validRollup, unpricedResponses: "1" }],
        dailyCostCapUsd: 1500,
      },
    ])(
      "drops a malformed autocomplete-usage reply and falls back to an empty snapshot: %j",
      async (reply) => {
        electronMocks.invoke.mockResolvedValue(reply);

        const result = await autocompleteFeature.getAutocompleteUsage();

        expect(result).toEqual({
          today: zeroedRollup,
          month: zeroedRollup,
          days: [],
          dailyCostCapUsd: 0,
        });
      },
    );
  });
});
