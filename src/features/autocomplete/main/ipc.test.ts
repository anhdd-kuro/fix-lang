import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAutocompleteHandlers } from "./ipc";

const { electronMocks, serviceMocks, usageStoreMocks, loggerMock } = vi.hoisted(() => ({
  electronMocks: { handle: vi.fn() },
  serviceMocks: {
    requestAutocompleteSuggestion: vi.fn(),
    // A value distinguishable from the real DAILY_REQUEST_CAP (1500), so a
    // test asserting on it proves the handler imports the constant rather
    // than hardcoding its own copy.
    DAILY_REQUEST_CAP: 42,
  },
  usageStoreMocks: {
    getDay: vi.fn(),
    getMonth: vi.fn(),
    getDays: vi.fn(),
  },
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("electron", () => ({ ipcMain: { handle: electronMocks.handle } }));
vi.mock("~/features/autocomplete/main/service", () => serviceMocks);
vi.mock("~/features/autocomplete/store/autocompleteUsageStore", () => ({
  autocompleteUsageStore: usageStoreMocks,
}));
vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

type Handler = (event: unknown, raw?: unknown) => unknown;

const getHandler = (channel: string): Handler => {
  const call = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`no handler registered for channel "${channel}"`);
  return call[1] as Handler;
};

const eventFrom = (senderId: number) => ({ sender: { id: senderId } });

const rollup = (date: string, requests: number, promptTokens: number, estimatedCostUsd: number) => ({
  date,
  requests,
  responses: requests,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens,
  completionTokens: Math.round(promptTokens / 5),
  estimatedCostUsd,
});

describe("registerAutocompleteHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAutocompleteHandlers();
  });

  describe("autocomplete-suggest", () => {
    it("derives sessionId from event.sender.id, never from the payload", async () => {
      serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({ requestId: 1, suggestion: null });

      await getHandler("autocomplete-suggest")(
        eventFrom(7),
        // A malicious/buggy renderer naming a session that belongs to another
        // window. The handler must not forward it.
        { requestId: 1, prefix: "prefix long enough", sessionId: "some-other-window" },
      );

      expect(serviceMocks.requestAutocompleteSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "7" }),
      );
      expect(serviceMocks.requestAutocompleteSuggestion).not.toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "some-other-window" }),
      );
    });

    it("passes requestId, prefix and suffix through to the service", async () => {
      serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({ requestId: 9, suggestion: "text" });

      await getHandler("autocomplete-suggest")(eventFrom(3), {
        requestId: 9,
        prefix: "the quick brown fox",
        suffix: " jumps",
      });

      expect(serviceMocks.requestAutocompleteSuggestion).toHaveBeenCalledWith({
        requestId: 9,
        prefix: "the quick brown fox",
        suffix: " jumps",
        sessionId: "3",
      });
    });

    it("returns the service's reply", async () => {
      serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({ requestId: 5, suggestion: "ghost" });

      const reply = await getHandler("autocomplete-suggest")(eventFrom(1), {
        requestId: 5,
        prefix: "twelve characters or more",
      });

      expect(reply).toEqual({ requestId: 5, suggestion: "ghost" });
    });

    it("falls back to safe values for a malformed payload instead of throwing", async () => {
      serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({ requestId: 0, suggestion: null });

      await getHandler("autocomplete-suggest")(eventFrom(2), "not an object");

      expect(serviceMocks.requestAutocompleteSuggestion).toHaveBeenCalledWith({
        requestId: 0,
        prefix: "",
        suffix: undefined,
        sessionId: "2",
      });
    });

    /**
     * A `NaN` requestId satisfies `typeof === "number"` and echoes back
     * unchanged, and `NaN !== NaN` makes the renderer's staleness comparison
     * reject every reply. Ghost text then never appears at all, with nothing
     * failing anywhere to say why.
     */
    it.each([NaN, Infinity, -Infinity])(
      "replaces a non-finite requestId with 0: %p",
      async (requestId) => {
        serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({ requestId: 0, suggestion: null });

        await getHandler("autocomplete-suggest")(eventFrom(1), {
          requestId,
          prefix: "twelve characters or more",
        });

        expect(serviceMocks.requestAutocompleteSuggestion).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: 0 }),
        );
      },
    );

    /**
     * The service builds the prompt OUTSIDE its own try, so a non-string suffix
     * reaching it throws out of `ipcMain.handle` — exactly the crash this typed
     * fallback exists to prevent.
     */
    it.each([42, null, {}, ["a"], true])(
      "drops a non-string suffix rather than forwarding it: %p",
      async (suffix) => {
        serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({ requestId: 1, suggestion: null });

        await getHandler("autocomplete-suggest")(eventFrom(1), {
          requestId: 1,
          prefix: "twelve characters or more",
          suffix,
        });

        expect(serviceMocks.requestAutocompleteSuggestion).toHaveBeenCalledWith(
          expect.objectContaining({ suffix: undefined }),
        );
      },
    );

    /**
     * The preload bridge validates the SHAPE of a reply, not the absence of a
     * rejection. Anything that throws past the service — a full disk in the
     * usage store was the observed case — would cross IPC as a rejected
     * `invoke` and surface as an unhandled rejection per keystroke.
     */
    it("answers with no suggestion instead of rejecting when the service throws", async () => {
      serviceMocks.requestAutocompleteSuggestion.mockRejectedValue(
        new Error("ENOSPC: no space left on device"),
      );

      const reply = getHandler("autocomplete-suggest")(eventFrom(1), {
        requestId: 11,
        prefix: "twelve characters or more",
      });

      await expect(reply).resolves.toEqual({ requestId: 11, suggestion: null });
      expect(loggerMock.warn).toHaveBeenCalled();
    });
  });

  describe("autocomplete-usage", () => {
    // The series must come from `getDays()`. A fixture of `[today]` would keep
    // passing if the handler answered `days: [getDay()]` and never read the
    // series at all, which is a dashboard showing one bar forever.
    it("returns today, month, the day series and the daily cap", async () => {
      const today = rollup("2026-07-31", 3, 10, 0.01);
      const month = rollup("2026-07-31", 30, 100, 0.1);
      const yesterday = rollup("2026-07-30", 7, 60, 0.04);
      const days = [today, yesterday];
      usageStoreMocks.getDay.mockReturnValue(today);
      usageStoreMocks.getMonth.mockReturnValue(month);
      usageStoreMocks.getDays.mockReturnValue(days);

      const snapshot = await getHandler("autocomplete-usage")(undefined);

      expect(snapshot).toEqual({ today, month, days, dailyCap: 42 });
      expect(usageStoreMocks.getDays).toHaveBeenCalledOnce();
    });

    it("reads the series from getDays, not from the single-day rollup", async () => {
      const today = rollup("2026-07-31", 3, 10, 0.01);
      const series = [rollup("2026-07-30", 7, 60, 0.04), rollup("2026-07-29", 2, 20, 0.01)];
      usageStoreMocks.getDay.mockReturnValue(today);
      usageStoreMocks.getMonth.mockReturnValue(today);
      usageStoreMocks.getDays.mockReturnValue(series);

      const snapshot = (await getHandler("autocomplete-usage")(undefined)) as { days: unknown };

      expect(snapshot.days).toEqual(series);
    });
  });
});
