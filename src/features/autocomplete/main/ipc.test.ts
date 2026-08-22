import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS } from "~/features/autocomplete/shared/autocompleteDiagnostics";
import { redactLogContext } from "~/features/logs/shared/logging";
import { registerAutocompleteHandlers } from "./ipc";
import type { LogContext } from "~/features/logs/shared/logging";

const { electronMocks, serviceMocks, usageStoreMocks, apiStoreMocks, loggerMock } = vi.hoisted(() => ({
  electronMocks: { handle: vi.fn(), on: vi.fn() },
  serviceMocks: {
    requestAutocompleteSuggestion: vi.fn(),
    takeAutocompleteResolution: vi.fn(),
  },
  // The cap is a PROFILE setting, not a module constant, so the handler has to
  // read it per call. A value no default could produce (42) proves the snapshot
  // came from the store rather than from a hardcoded copy.
  apiStoreMocks: { getProfileSetting: vi.fn(() => ({ enabled: true, model: "", dailyCostCapUsd: 42 })) },
  usageStoreMocks: {
    getDay: vi.fn(),
    getMonth: vi.fn(),
    getDays: vi.fn(),
  },
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle, on: electronMocks.on },
}));
vi.mock("~/features/autocomplete/main/service", () => serviceMocks);
vi.mock("~/features/autocomplete/store/autocompleteUsageStore", () => ({
  autocompleteUsageStore: usageStoreMocks,
}));
vi.mock("~/features/providers/store/apiStore", () => apiStoreMocks);
vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

type Handler = (event: unknown, raw?: unknown) => unknown;

const getHandler = (channel: string): Handler => {
  const call = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`no handler registered for channel "${channel}"`);
  return call[1] as Handler;
};

/** The one-way `ipcMain.on` listener, as distinct from an `invoke` handler. */
const getListener = (channel: string): Handler => {
  const call = electronMocks.on.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`no listener registered for channel "${channel}"`);
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
        surface: "own",
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
        surface: "own",
      });
    });

    it("states surface own even for junk, so a scope gate is never skipped by omission", async () => {
      serviceMocks.requestAutocompleteSuggestion.mockResolvedValue({ requestId: 0, suggestion: null });

      await getHandler("autocomplete-suggest")(eventFrom(2), {
        requestId: 1,
        prefix: "twelve characters or more",
        surface: "system",
        appBundleId: "com.apple.mail",
      });

      const [request] = serviceMocks.requestAutocompleteSuggestion.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(request.surface).toBe("own");
      expect(request).not.toHaveProperty("appBundleId");
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

  /**
   * The renderer half of "why is there no ghost text". When the renderer never
   * dispatches, main never runs and NOTHING is logged anywhere, so this channel
   * is the only thing that can tell "the input window never asked" apart from
   * "main refused". It is also renderer input landing in a copyable, exportable
   * log file, which is why the shape below is rebuilt field by field rather
   * than spread.
   */
  describe("autocomplete-skip", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const report = (overrides: Record<string, unknown> = {}): unknown => ({
      reason: "prefix-too-short",
      prefixLength: 4,
      suppressedSincePrevious: 0,
      ...overrides,
    });

    const send = (raw: unknown): void => {
      getListener("autocomplete-skip")(eventFrom(1), raw);
    };

    /** The context of the single debug line the listener emitted. */
    const loggedContext = (callIndex = 0): LogContext =>
      loggerMock.debug.mock.calls[callIndex]?.[2] as LogContext;

    it("logs the reason the renderer gave", () => {
      send(report({ reason: "composing", prefixLength: 9 }));

      expect(loggerMock.debug).toHaveBeenCalledOnce();
      expect(loggedContext()).toMatchObject({
        reason: "composing",
        prefixLength: 9,
      });
    });

    it.each([
      "composing",
      "prefix-too-short",
      "caret-moved",
      "bridge-unavailable",
    ])("accepts the known reason %s", (reason) => {
      send(report({ reason }));

      expect(loggedContext()).toMatchObject({ reason });
    });

    /**
     * `reply-too-late` is the odd reason out: a request that WAS dispatched and
     * WAS billed, whose answer landed after the caret had moved on. Only the
     * renderer can see that; only main may name the model, because a model id
     * sent up from the renderer would be renderer-controlled text in a file the
     * user can export. So the report carries an id and main answers it from its
     * own records.
     */
    describe("reply-too-late", () => {
      const RESOLUTION = {
        requestId: 4,
        model: "ornith-1.0-35b",
        provider: "lmstudio",
        latencyMs: 24484,
      };

      const lateReport = (overrides: Record<string, unknown> = {}): unknown =>
        report({ reason: "reply-too-late", requestId: 4, prefixLength: 39, ...overrides });

      const lateContext = (): LogContext =>
        (loggerMock.warn.mock.calls[0]?.[2] ?? loggerMock.debug.mock.calls[0]?.[2]) as LogContext;

      beforeEach(() => {
        serviceMocks.takeAutocompleteResolution.mockReturnValue(RESOLUTION);
      });

      it("names the model, the provider and the latency the model actually took", () => {
        send(lateReport());

        expect(lateContext()).toMatchObject({
          reason: "reply-too-late",
          model: "ornith-1.0-35b",
          provider: "lmstudio",
          latencyMs: 24484,
          prefixLength: 39,
        });
      });

      /**
       * Session from the sender, id from the payload — the same split the
       * suggest handler uses, and for the same reason: a renderer that could
       * name someone else's session could read a window it does not own.
       */
      it("looks the reply up under the sender's session and the reported id", () => {
        send(lateReport({ requestId: 9 }));

        expect(serviceMocks.takeAutocompleteResolution).toHaveBeenCalledWith("1", 9);
      });

      /**
       * No record means no provider was called (a cache hit or a refusal), so
       * there is no model or latency to blame. A line naming neither says
       * nothing the user could act on, so nothing is said.
       */
      it("says nothing when main has no matching round trip to blame", () => {
        serviceMocks.takeAutocompleteResolution.mockReturnValue(null);

        send(lateReport());

        expect(loggerMock.debug).not.toHaveBeenCalled();
        expect(loggerMock.warn).not.toHaveBeenCalled();
      });

      it.each([undefined, "4", NaN, Infinity, null, {}])(
        "says nothing for an unusable requestId: %p",
        (requestId) => {
          send(lateReport({ requestId }));

          expect(serviceMocks.takeAutocompleteResolution).not.toHaveBeenCalled();
          expect(loggerMock.debug).not.toHaveBeenCalled();
          expect(loggerMock.warn).not.toHaveBeenCalled();
        },
      );

      /**
       * One late reply during fast typing is normal and costs the user nothing
       * they would notice. EVERY reply late is a misconfigured model — nothing
       * on screen says so, and no amount of retrying fixes it.
       */
      it("stays at debug for a one-off", () => {
        send(lateReport());

        expect(loggerMock.debug).toHaveBeenCalledOnce();
        expect(loggerMock.warn).not.toHaveBeenCalled();
      });

      it("warns once the renderer says it has been swallowing repeats", () => {
        send(lateReport({ suppressedSincePrevious: 12 }));

        expect(loggerMock.warn).toHaveBeenCalledOnce();
        expect(loggerMock.debug).not.toHaveBeenCalled();
      });

      it("warns once main's own throttle has been swallowing repeats", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 31, 12, 0, 0));
        send(lateReport());
        for (let i = 0; i < 3; i += 1) send(lateReport());

        vi.advanceTimersByTime(AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS);
        send(lateReport());

        expect(loggerMock.debug).toHaveBeenCalledOnce();
        expect(loggerMock.warn).toHaveBeenCalledOnce();
        expect(loggerMock.warn.mock.calls[0]?.[2]).toMatchObject({ suppressedInMain: 3 });
      });

      it("throttles like every other reason, so a stuck model cannot flood the log", () => {
        for (let i = 0; i < 50; i += 1) send(lateReport());

        expect(loggerMock.debug.mock.calls.length + loggerMock.warn.mock.calls.length).toBe(1);
      });

      /**
       * The whole line is about a model, so a renderer offering one is the
       * likeliest way typed text would arrive dressed as metadata.
       */
      it("ignores a model the renderer supplies and uses main's own", () => {
        const typed = "my private unsent sentence";

        send(lateReport({ model: typed, provider: typed, latencyMs: 1 }));

        expect(JSON.stringify(loggerMock.debug.mock.calls)).not.toContain(typed);
        expect(lateContext()).toMatchObject({ model: "ornith-1.0-35b", latencyMs: 24484 });
      });

      it("emits only context keys that survive the real redactor", () => {
        send(lateReport());

        expect(redactLogContext(lateContext())).toEqual(lateContext());
      });

      it("carries no key beyond the measurements and the counts", () => {
        send(lateReport());

        expect(Object.keys(lateContext()).sort()).toEqual([
          "latencyMs",
          "model",
          "prefixLength",
          "provider",
          "reason",
          "suppressedInMain",
          "suppressedInRenderer",
        ]);
      });
    });

    /**
     * An unknown `reason` is renderer-controlled text, and forwarding it would
     * write whatever a compromised or buggy renderer sent straight into
     * `userData/logs/*.jsonl`. Dropped, not logged as "malformed" — logging it
     * would hand the flood back to whoever caused it.
     */
    it.each([
      "not-a-reason",
      "",
      42,
      null,
      undefined,
      { reason: "composing" },
      ["composing"],
    ])("drops a report whose reason is %p", (reason) => {
      send(report({ reason }));

      expect(loggerMock.debug).not.toHaveBeenCalled();
    });

    it.each(["not an object", null, undefined, 7, []])(
      "drops a non-report payload: %p",
      (raw) => {
        send(raw);

        expect(loggerMock.debug).not.toHaveBeenCalled();
      },
    );

    /**
     * `NaN`, `-1` and `Infinity` all pass `typeof === "number"` and would be
     * written verbatim as if they were measurements.
     */
    it.each([NaN, Infinity, -Infinity, -1, "12", null, {}])(
      "replaces an unusable prefixLength with 0: %p",
      (prefixLength) => {
        send(report({ prefixLength }));

        expect(loggedContext()).toMatchObject({ prefixLength: 0 });
      },
    );

    it("floors a fractional prefixLength rather than logging it raw", () => {
      send(report({ prefixLength: 12.7 }));

      expect(loggedContext()).toMatchObject({ prefixLength: 12 });
    });

    it.each([NaN, -3, "many"])(
      "replaces an unusable suppressed count with 0: %p",
      (suppressedSincePrevious) => {
        send(report({ suppressedSincePrevious }));

        expect(loggedContext()).toMatchObject({ suppressedInRenderer: 0 });
      },
    );

    /**
     * These arrive on the typing path. Main throttles as well as the renderer
     * because the renderer is untrusted AND is the side under suspicion — a
     * renderer whose own throttle is broken must not be able to write a line
     * per keystroke into a file the user later exports.
     */
    describe("throttling", () => {
      it("logs one line per reason however many arrive", () => {
        for (let i = 0; i < 50; i += 1) send(report());

        expect(loggerMock.debug).toHaveBeenCalledOnce();
      });

      it("reports how many it suppressed on the next line for that reason", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 31, 12, 0, 0));
        send(report());
        for (let i = 0; i < 4; i += 1) send(report());

        vi.advanceTimersByTime(AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS);
        send(report());

        expect(loggerMock.debug).toHaveBeenCalledTimes(2);
        expect(loggedContext(1)).toMatchObject({ suppressedInMain: 4 });
      });

      it("does not let one reason silence a different one", () => {
        send(report({ reason: "prefix-too-short" }));
        send(report({ reason: "caret-moved" }));

        expect(loggerMock.debug).toHaveBeenCalledTimes(2);
      });

      /**
       * The renderer's count says what never reached the wire; main's says what
       * reached it and was dropped here. One number cannot mean both, and
       * collapsing them would hide a renderer whose throttle stopped working.
       */
      it("keeps the renderer's suppressed count distinct from its own", () => {
        send(report({ suppressedSincePrevious: 37 }));

        expect(loggedContext()).toMatchObject({
          suppressedInRenderer: 37,
          suppressedInMain: 0,
        });
      });
    });

    /**
     * `redactLogContext` blanks any key merely CONTAINING `clipboard`, `token`,
     * `secret` or `selected_text`. A well-meant `selected_text_length` persists
     * as `"[REDACTED]"` with no error at all — this project has already lost one
     * metric that way (`selectionPoll`). Run the real redactor, not an eyeball.
     */
    it("emits only context keys that survive the real redactor", () => {
      send(report({ reason: "caret-moved", prefixLength: 31, suppressedSincePrevious: 2 }));

      expect(redactLogContext(loggedContext())).toEqual(loggedContext());
    });

    /**
     * The feature exists to send text the user has NOT chosen to send anywhere,
     * and these lines are copyable and exportable from the Logs tab. The wire
     * shape carries no text at all — and if a renderer adds one, it must not
     * reach the log.
     */
    it("never logs typed text, even when the renderer sends some", () => {
      const typed = "my private unsent sentence";

      send(report({ prefix: typed, suffix: typed, suggestion: typed, text: typed }));

      const serialized = JSON.stringify(loggerMock.debug.mock.calls);
      expect(serialized).not.toContain(typed);
      expect(Object.keys(loggedContext()).sort()).toEqual([
        "prefixLength",
        "reason",
        "suppressedInMain",
        "suppressedInRenderer",
      ]);
    });
  });

  describe("autocomplete-usage", () => {
    // The series must come from `getDays()`. A fixture of `[today]` would keep
    // passing if the handler answered `days: [getDay()]` and never read the
    // series at all, which is a dashboard showing one bar forever.
    it("returns today, month, the day series and the daily spend cap", async () => {
      const today = rollup("2026-07-31", 3, 10, 0.01);
      const month = rollup("2026-07-31", 30, 100, 0.1);
      const yesterday = rollup("2026-07-30", 7, 60, 0.04);
      const days = [today, yesterday];
      usageStoreMocks.getDay.mockReturnValue(today);
      usageStoreMocks.getMonth.mockReturnValue(month);
      usageStoreMocks.getDays.mockReturnValue(days);

      const snapshot = await getHandler("autocomplete-usage")(undefined);

      expect(snapshot).toEqual({ today, month, days, dailyCostCapUsd: 42 });
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
