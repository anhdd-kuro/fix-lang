import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREFIX_WINDOW_CHARS } from "./prompt";
import {
  abortAutocomplete,
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  DAILY_REQUEST_CAP,
  MAX_OUTPUT_TOKENS,
  MIN_PREFIX_CHARS,
  requestAutocompleteSuggestion,
  resetAutocompleteState,
} from "./service";

const {
  makeAIRequestMock,
  getCachedModelsMock,
  computeCostMock,
  getProfileSettingMock,
  getDefaultModelIdMock,
  getCurrentProfileIdMock,
  usageStoreMock,
  loggerMock,
} = vi.hoisted(() => ({
  makeAIRequestMock: vi.fn(),
  // A mock rather than a plain stub: it reads a store, so the tests have to be
  // able to make it throw the way the store does in the field.
  getCachedModelsMock: vi.fn(),
  computeCostMock: vi.fn(),
  getProfileSettingMock: vi.fn(),
  getDefaultModelIdMock: vi.fn(),
  getCurrentProfileIdMock: vi.fn(),
  usageStoreMock: {
    recordDispatch: vi.fn(),
    recordUsage: vi.fn(),
    getDay: vi.fn(),
    getMonth: vi.fn(),
  },
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("~/main/ai.request/shared", () => ({
  makeAIRequest: makeAIRequestMock,
  getCachedModels: getCachedModelsMock,
}));
vi.mock("~/main/ai.request/cost", () => ({
  buildPriceMap: () => new Map(),
  computeCost: computeCostMock,
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  getProfileSetting: getProfileSettingMock,
  getDefaultModelId: getDefaultModelIdMock,
  getCurrentProfileId: getCurrentProfileIdMock,
}));
vi.mock("~/features/autocomplete/store/autocompleteUsageStore", () => ({
  autocompleteUsageStore: usageStoreMock,
}));
vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

const LONG_PREFIX = "The quick brown fox jumps";

/**
 * The service reaches `makeAIRequest` through a dynamic import, so a single
 * microtask tick is not enough for the call to land. Poll instead of guessing a
 * tick count.
 */
const waitForCalls = async (count: number): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (makeAIRequestMock.mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `expected ${count} request(s), saw ${makeAIRequestMock.mock.calls.length}`,
  );
};

const respondWith = (text: string) =>
  makeAIRequestMock.mockResolvedValue({
    content: [text],
    model: "gpt-4o-mini",
    provider: "openai",
    promptTokens: 100,
    completionTokens: 8,
  });

/**
 * A stateful stand-in for the usage store's day counter. The cap is read back
 * through `getDay()` between requests, so a fixed return value could never
 * show whether a dispatch was counted at all.
 */
let dayRequests = 0;

/**
 * The active BACKEND, as the cache key must see it. A profile switch moves the
 * first; editing a local provider's host moves the second without any switch.
 */
let currentProfileId = "profile-a";
let providerEndpoints: Record<string, { host: string; port: number }> = {};

/** Leaves every request in flight so it can be superseded and aborted. */
const pendingRequests = (): AbortSignal[] => {
  const signals: AbortSignal[] = [];
  makeAIRequestMock.mockImplementation((options: { abortSignal: AbortSignal }) => {
    signals.push(options.abortSignal);
    return new Promise(() => {
      // Never settles: the request stays in flight for the test.
    });
  });
  return signals;
};

describe("requestAutocompleteSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAutocompleteState();
    currentProfileId = "profile-a";
    providerEndpoints = {};
    getProfileSettingMock.mockImplementation((key: string) => {
      if (key === "settingsAutocomplete") return { enabled: true, model: "openai::gpt-4o-mini" };
      if (key === "settingsCorrect") return { presets: [], selectedPresetId: "" };
      if (key === "providerEndpoints") return providerEndpoints;
      return undefined;
    });
    getCurrentProfileIdMock.mockImplementation(() => currentProfileId);
    getDefaultModelIdMock.mockReturnValue("openai::gpt-4o");
    dayRequests = 0;
    usageStoreMock.recordDispatch.mockImplementation(() => {
      dayRequests += 1;
    });
    usageStoreMock.getDay.mockImplementation(() => ({
      date: "2026-07-31",
      requests: dayRequests,
      responses: 0,
      tokenlessResponses: 0,
      unpricedResponses: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    }));
    getCachedModelsMock.mockReturnValue([]);
    computeCostMock.mockReturnValue({
      status: "ok",
      estimatedCostUsd: 0.0004,
      pricePrompt: "0.000003",
      priceCompletion: "0.000012",
    });
    respondWith(" over the lazy dog.");
  });

  const ask = (overrides: Record<string, unknown> = {}) =>
    requestAutocompleteSuggestion({
      requestId: 1,
      sessionId: "window-1",
      prefix: LONG_PREFIX,
      ...overrides,
    });

  it("returns a sanitized suggestion and echoes the request id", async () => {
    const result = await ask({ requestId: 7 });

    expect(result).toEqual({ requestId: 7, suggestion: " over the lazy dog." });
  });

  describe("gates that make no request at all", () => {
    it("is inert when the feature is disabled", async () => {
      getProfileSettingMock.mockImplementation((key: string) =>
        key === "settingsAutocomplete" ? { enabled: false, model: "" } : { presets: [] },
      );

      expect((await ask()).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    it("skips a prefix shorter than the minimum", async () => {
      expect((await ask({ prefix: "a".repeat(MIN_PREFIX_CHARS - 1) })).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    it("makes a request once the prefix reaches the minimum", async () => {
      await ask({ prefix: "a".repeat(MIN_PREFIX_CHARS) });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    it("skips when no model resolves anywhere", async () => {
      getProfileSettingMock.mockImplementation((key: string) =>
        key === "settingsAutocomplete" ? { enabled: true, model: "" } : { presets: [] },
      );
      getDefaultModelIdMock.mockReturnValue("");

      expect((await ask()).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });
  });

  describe("model resolution", () => {
    it("uses the stored ref when set", async () => {
      await ask();

      expect(makeAIRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: "openai::gpt-4o-mini" }),
      );
    });

    it("falls back to the Ask preset's model", async () => {
      getProfileSettingMock.mockImplementation((key: string) => {
        if (key === "settingsAutocomplete") return { enabled: true, model: "" };
        return { presets: [{ id: "ask", model: "openrouter::llama" }], selectedPresetId: "" };
      });

      await ask();

      expect(makeAIRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: "openrouter::llama" }),
      );
    });

    it("falls through to the global default when Ask itself inherits", async () => {
      getProfileSettingMock.mockImplementation((key: string) => {
        if (key === "settingsAutocomplete") return { enabled: true, model: "" };
        return { presets: [{ id: "ask", model: "" }], selectedPresetId: "" };
      });

      await ask();

      expect(makeAIRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: "openai::gpt-4o" }),
      );
    });
  });

  // The whole point of the feature's cost profile.
  describe("request shape", () => {
    it("forces reasoning off, caps output, stops early, and stays quiet", async () => {
      await ask();

      expect(makeAIRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: "none",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          stop: ["\n\n"],
          quiet: true,
        }),
      );
    });

    it("passes an abort signal", async () => {
      await ask();

      const [options] = makeAIRequestMock.mock.calls[0];
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    });

    // Undefined would omit the parameter and a reasoning model's own default is
    // reasoning ON — the exact bug the literal guards against.
    it("sends the literal \"none\", never undefined", async () => {
      await ask();

      const [options] = makeAIRequestMock.mock.calls[0];
      expect(options.reasoning).toBe("none");
    });
  });

  describe("de-duplication", () => {
    it("serves an identical prefix from cache without a second request", async () => {
      await ask();
      const second = await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
      expect(second).toEqual({ requestId: 2, suggestion: " over the lazy dog." });
    });

    it("treats a different prefix as a new request", async () => {
      await ask();
      await ask({ prefix: `${LONG_PREFIX} again` });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
    });

    // A cached "no suggestion" must also suppress the retry, or an unhelpful
    // prefix is paid for on every keystroke that returns to it.
    it("caches a null result too", async () => {
      respondWith("   ");

      expect((await ask()).suggestion).toBeNull();
      expect((await ask({ requestId: 2 })).suggestion).toBeNull();
      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });
  });

  describe("single flight", () => {
    const pending = pendingRequests;

    it("aborts the previous request for the same surface", async () => {
      const signals = pending();

      void ask({ prefix: `${LONG_PREFIX} one` });
      await waitForCalls(1);
      void ask({ prefix: `${LONG_PREFIX} two` });
      await waitForCalls(2);

      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    });

    it("leaves another surface's request alone", async () => {
      const signals = pending();

      void ask({ prefix: `${LONG_PREFIX} one`, sessionId: "window-1" });
      await waitForCalls(1);
      void ask({ prefix: `${LONG_PREFIX} two`, sessionId: "window-2" });
      await waitForCalls(2);

      expect(signals[0].aborted).toBe(false);
      expect(signals[1].aborted).toBe(false);
    });

    // A stale in-flight request must resolve to null rather than deliver a
    // suggestion for text the user has already moved past.
    it("resolves an aborted request to no suggestion", async () => {
      makeAIRequestMock.mockImplementation(
        (options: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );

      const inFlightRequest = ask({ prefix: `${LONG_PREFIX} one` });
      await waitForCalls(1);
      abortAutocomplete("window-1");

      expect((await inFlightRequest).suggestion).toBeNull();
    });

    /**
     * A superseded request's cleanup must not evict the entry that replaced
     * it. Deleting unconditionally instead of only when the map still holds
     * THIS controller left the surface with no registered request, so the next
     * keystroke had nothing to abort and two calls ran on in parallel — both
     * billed, only one wanted.
     */
    it("does not let a superseded request unregister its successor", async () => {
      // Must actually settle on abort: a request that never rejects never runs
      // its cleanup, and cleanup is the whole subject here.
      const signals: AbortSignal[] = [];
      makeAIRequestMock.mockImplementation((options: { abortSignal: AbortSignal }) => {
        signals.push(options.abortSignal);
        return new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });

      void ask({ prefix: `${LONG_PREFIX} one` });
      await waitForCalls(1);
      void ask({ prefix: `${LONG_PREFIX} two` });
      await waitForCalls(2);
      // Let the first request's abort rejection settle so its cleanup runs.
      await new Promise((resolve) => setTimeout(resolve, 0));
      void ask({ prefix: `${LONG_PREFIX} three` });
      await waitForCalls(3);

      expect(signals[1].aborted).toBe(true);
    });

    it("aborts every surface when no session is named", async () => {
      const signals = pending();

      void ask({ sessionId: "window-1", prefix: `${LONG_PREFIX} a` });
      await waitForCalls(1);
      void ask({ sessionId: "window-2", prefix: `${LONG_PREFIX} b` });
      await waitForCalls(2);
      abortAutocomplete();

      expect(signals.every((signal) => signal.aborted)).toBe(true);
    });

    /**
     * THE ROUTE: the cache hit's early `return`, which used to sit ABOVE
     * `abortAutocomplete(sessionId)`.
     *
     * Named after the route rather than the symptom on purpose. "A request kept
     * billing after it was obsolete" has now arrived by several different paths,
     * and every fix that closed only the path it was reported on let the next one
     * through — so what is pinned here is which line the return jumps over.
     *
     * Backspace-and-retype is the motion `CACHE_TTL_MS` exists to serve, so this
     * is the ordinary case: the user edits back to a prefix answered seconds ago
     * while the request for the prefix they just left is still open. Returning
     * the cached suggestion first left that request to run to completion, billed
     * in full, its reply then discarded as stale.
     */
    it("aborts the request still in flight when it serves a cache hit", async () => {
      // The first answer has to actually land, so there is something cached.
      await ask({ prefix: `${LONG_PREFIX} one` });
      const signals = pending();
      void ask({ prefix: `${LONG_PREFIX} two` });
      await waitForCalls(2);

      const fromCache = await ask({ requestId: 3, prefix: `${LONG_PREFIX} one` });

      expect(fromCache).toEqual({ requestId: 3, suggestion: " over the lazy dog." });
      // No new call — it really was a cache hit, not a re-request.
      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
      expect(signals[0].aborted).toBe(true);
    });

    // Scoped like every other abort here: one surface's cache hit says nothing
    // about what another typing surface is still waiting for.
    it("leaves another surface's request alone when it serves a cache hit", async () => {
      await ask({ prefix: `${LONG_PREFIX} one`, sessionId: "window-1" });
      const signals = pending();
      void ask({ prefix: `${LONG_PREFIX} two`, sessionId: "window-2" });
      await waitForCalls(2);

      await ask({ requestId: 3, prefix: `${LONG_PREFIX} one`, sessionId: "window-1" });

      expect(signals[0].aborted).toBe(false);
    });
  });

  describe("daily cap", () => {
    const atCap = () => {
      dayRequests = DAILY_REQUEST_CAP;
    };

    it("stops making requests once tripped", async () => {
      atCap();

      expect((await ask()).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    // Once tripped this path runs on every keystroke; one line per day, not one
    // per press.
    it("warns once per day, not once per keystroke", async () => {
      atCap();

      await ask();
      await ask({ prefix: `${LONG_PREFIX} more` });

      expect(loggerMock.warn).toHaveBeenCalledOnce();
    });

    /**
     * The exact scenario the cap exists for. A user typing continuously has
     * every request superseded and aborted before it can return, yet the
     * provider was asked — and bills — for each one. Counting only completions
     * left the counter at zero here and the hard stop never fired.
     */
    it("counts a dispatched request that is later aborted", async () => {
      dayRequests = DAILY_REQUEST_CAP - 2;
      const signals = pendingRequests();

      void ask({ prefix: `${LONG_PREFIX} one` });
      await waitForCalls(1);
      void ask({ prefix: `${LONG_PREFIX} two` });
      await waitForCalls(2);

      expect(signals[0].aborted).toBe(true);
      expect((await ask({ prefix: `${LONG_PREFIX} three` })).suggestion).toBeNull();
      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
    });

    it("counts a dispatched request that fails", async () => {
      makeAIRequestMock.mockRejectedValue(new Error("401 unauthorized"));

      await ask();

      expect(usageStoreMock.recordDispatch).toHaveBeenCalledOnce();
    });

    it("does not count a suggestion served from cache", async () => {
      await ask();
      await ask({ requestId: 2 });

      expect(usageStoreMock.recordDispatch).toHaveBeenCalledOnce();
    });

    it("does not count a request the cap itself refused", async () => {
      atCap();

      await ask();

      expect(usageStoreMock.recordDispatch).not.toHaveBeenCalled();
    });

    it.each([
      ["the feature is disabled", { enabled: false, model: "openai::gpt-4o-mini" }, LONG_PREFIX],
      ["the prefix is too short", { enabled: true, model: "openai::gpt-4o-mini" }, "short"],
      ["no model resolves", { enabled: true, model: "" }, LONG_PREFIX],
    ])("does not count a request gated before dispatch: %s", async (_case, settings, prefix) => {
      getProfileSettingMock.mockImplementation((key: string) =>
        key === "settingsAutocomplete" ? settings : { presets: [] },
      );
      getDefaultModelIdMock.mockReturnValue("");

      await ask({ prefix });

      expect(usageStoreMock.recordDispatch).not.toHaveBeenCalled();
    });
  });

  describe("spend and logging", () => {
    it("records usage for a completed request", async () => {
      await ask();

      expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ promptTokens: 100, completionTokens: 8 }),
        expect.any(Date),
      );
    });

    /**
     * The computed cost had no assertion anywhere, so replacing it with a
     * literal `0` — the exact false zero this feature's money path must never
     * print — survived the whole suite.
     */
    describe("the computed cost", () => {
      it("prices the model the provider actually served", async () => {
        makeAIRequestMock.mockResolvedValue({
          content: [" over the lazy dog."],
          model: "openai::gpt-4o-mini",
          resolvedModel: "gpt-4o-mini-2026-01-01",
          provider: "openai",
          promptTokens: 100,
          completionTokens: 8,
        });

        await ask();

        expect(computeCostMock).toHaveBeenCalledWith(
          {
            provider: "openai",
            model: "openai::gpt-4o-mini",
            resolvedModel: "gpt-4o-mini-2026-01-01",
            promptTokens: 100,
            completionTokens: 8,
          },
          expect.anything(),
        );
      });

      it("reaches the rollup unchanged", async () => {
        computeCostMock.mockReturnValue({
          status: "ok",
          estimatedCostUsd: 0.00123,
          pricePrompt: "0.000003",
          priceCompletion: "0.000012",
        });

        await ask();

        expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
          expect.objectContaining({ estimatedCostUsd: 0.00123 }),
          expect.any(Date),
        );
      });

      /**
       * `computeCost` returns N/A unconditionally for direct OpenAI, so this is
       * what every OpenAI autocomplete request records. Coalescing that null to
       * `0` on the way to the store made a day of genuinely billed requests
       * report `$0.00`; the store now counts it as an unpriced response
       * instead, and it can only do that if the null arrives intact.
       */
      it("passes an unpriceable cost through as null, never as zero", async () => {
        computeCostMock.mockReturnValue({
          status: "na",
          estimatedCostUsd: null,
          pricePrompt: null,
          priceCompletion: null,
        });

        await ask();

        expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
          expect.objectContaining({ estimatedCostUsd: null }),
          expect.any(Date),
        );
      });

      /**
       * The false `$0.00` came back through here after the coverage counters
       * were added, because tokens and price were treated as independent axes
       * and a price MULTIPLIED OUT OF TOKENS is not independent of them.
       *
       * A PRICEABLE PROVIDER THAT OMITS ITS USAGE BLOCK — OpenRouter, Bedrock —
       * matches the price map, so `computeCost` succeeds: `status: "ok"` with a
       * cost of `0 × price`. Booked as priced, the day reported
       * `unpricedResponses: 0` beside `estimatedCostUsd: 0` and the card printed
       * "Est. $0.00" as the whole truth over spend the provider really billed.
       * Only the local-provider case below is a real zero.
       */
      it("does not book a priceable provider's tokenless response as a priced zero", async () => {
        makeAIRequestMock.mockResolvedValue({
          content: [" over the lazy dog."],
          model: "openrouter::meta-llama/llama-3.3-70b-instruct",
          provider: "openrouter",
          promptTokens: null,
          completionTokens: null,
        });
        computeCostMock.mockReturnValue({
          status: "ok",
          estimatedCostUsd: 0,
          pricePrompt: "0.0000009",
          priceCompletion: "0.0000009",
        });

        await ask();

        expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
          { promptTokens: null, completionTokens: null, estimatedCostUsd: null },
          expect.any(Date),
        );
      });

      // Half the counts is still a price derived from a number the provider
      // never sent, so the amount is no more knowable than the missing half.
      it("does not book a priceable provider's half-reported response as priced", async () => {
        makeAIRequestMock.mockResolvedValue({
          content: [" over the lazy dog."],
          model: "openrouter::meta-llama/llama-3.3-70b-instruct",
          provider: "openrouter",
          promptTokens: 100,
          completionTokens: null,
        });
        computeCostMock.mockReturnValue({
          status: "ok",
          estimatedCostUsd: 0.00009,
          pricePrompt: "0.0000009",
          priceCompletion: "0.0000009",
        });

        await ask();

        expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
          expect.objectContaining({ estimatedCostUsd: null }),
          expect.any(Date),
        );
      });

      /**
       * The other side of the same rule, and the reason it is keyed on
       * `status` rather than on the missing tokens alone: Ollama and LM Studio
       * report no tokens either, but `computeCost` short-circuits them to
       * `status: "zero"` without multiplying anything, so their `$0` is a
       * measurement. Reading it as N/A would be its own wrong answer.
       */
      it("still books a local provider's tokenless $0 as a real, priced zero", async () => {
        makeAIRequestMock.mockResolvedValue({
          content: [" over the lazy dog."],
          model: "ollama::llama3.2",
          provider: "ollama",
          promptTokens: null,
          completionTokens: null,
        });
        computeCostMock.mockReturnValue({
          status: "zero",
          estimatedCostUsd: 0,
          pricePrompt: null,
          priceCompletion: null,
        });

        await ask();

        expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
          expect.objectContaining({ estimatedCostUsd: 0 }),
          expect.any(Date),
        );
      });
    });

    /**
     * Ollama and LM Studio return no token counts at all. Dropping their usage
     * row entirely went unnoticed: no test drove a null-token response, so
     * every local-provider request recorded a dispatch and then silently lost
     * its response — and with it the only evidence the request ever returned.
     */
    it("records usage for a response that reported no token counts", async () => {
      makeAIRequestMock.mockResolvedValue({
        content: [" over the lazy dog."],
        model: "ollama::llama3.2",
        provider: "ollama",
        promptTokens: null,
        completionTokens: null,
      });
      computeCostMock.mockReturnValue({
        status: "zero",
        estimatedCostUsd: 0,
        pricePrompt: null,
        priceCompletion: null,
      });

      await ask();

      expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
        // Null, not 0: the store counts the gap rather than averaging it away.
        { promptTokens: null, completionTokens: null, estimatedCostUsd: 0 },
        expect.any(Date),
      );
    });

    // The typed text IS the payload; redaction cannot save a log line that
    // contains it.
    it("logs the prefix length and never the prefix itself", async () => {
      await ask();

      const [, , context] = loggerMock.debug.mock.calls[0];
      expect(context.prefixLength).toBe(LONG_PREFIX.length);
      expect(JSON.stringify(context)).not.toContain("quick brown fox");
    });

    // A request with no response has no usage to record. Writing zeroes would
    // pad the token and spend figures with measurements that never happened.
    it("returns no suggestion and records no usage when the request fails", async () => {
      makeAIRequestMock.mockRejectedValue(new Error("401 unauthorized"));

      expect((await ask()).suggestion).toBeNull();
      expect(usageStoreMock.recordUsage).not.toHaveBeenCalled();
    });

    it("records no usage for a request that was aborted mid-flight", async () => {
      makeAIRequestMock.mockImplementation(
        (options: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );

      const inFlightRequest = ask({ prefix: `${LONG_PREFIX} one` });
      await waitForCalls(1);
      abortAutocomplete("window-1");

      expect((await inFlightRequest).suggestion).toBeNull();
      expect(usageStoreMock.recordDispatch).toHaveBeenCalledOnce();
      expect(usageStoreMock.recordUsage).not.toHaveBeenCalled();
    });

    /**
     * A Bedrock `AccessDeniedException` states the AWS account id and the full
     * IAM principal ARN in its message, and neither `SENSITIVE_KEY` nor
     * `redactLogMessage` reduces either. Logged verbatim from a path that runs
     * once per failing keystroke, that put account identifiers into
     * userData/logs/*.jsonl hundreds of times, copyable and exportable from the
     * Logs tab.
     */
    it("logs the failure's class, never the provider's message", async () => {
      const denied = new Error(
        "User: arn:aws:iam::123456789012:user/fixlang is not authorized to perform bedrock:InvokeModel",
      );
      denied.name = "AccessDeniedException";
      makeAIRequestMock.mockRejectedValue(denied);

      await ask();

      const [, , context] = loggerMock.debug.mock.calls[0];
      expect(context.errorName).toBe("AccessDeniedException");
      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain("arn:aws:iam");
      expect(serialized).not.toContain("123456789012");
    });

    it("keeps a numeric status when the provider supplies one", async () => {
      const rejected = Object.assign(new Error("Rate limit reached for org-abc"), {
        name: "RateLimitError",
        status: 429,
      });
      makeAIRequestMock.mockRejectedValue(rejected);

      await ask();

      const [, , context] = loggerMock.debug.mock.calls[0];
      expect(context).toMatchObject({ errorName: "RateLimitError", status: 429 });
      expect(JSON.stringify(context)).not.toContain("org-abc");
    });
  });

  /**
   * Both halves of one request share the dispatching instant. Giving each its
   * own `new Date()` booked a request dispatched at 23:59:59.9 and answered at
   * 00:00:00.1 across two days: yesterday held a request with no spend, today
   * held spend with no request, and `getMonth` counted one without the other
   * across a month boundary.
   */
  describe("a request that crosses midnight", () => {
    const lastMoment = new Date(2026, 6, 31, 23, 59, 59, 900);
    const justAfter = new Date(2026, 7, 1, 0, 0, 0, 100);

    it("books its dispatch and its usage on the same day", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(lastMoment);
        makeAIRequestMock.mockImplementation(() => {
          vi.setSystemTime(justAfter);
          return Promise.resolve({
            content: [" over the lazy dog."],
            model: "gpt-4o-mini",
            provider: "openai",
            promptTokens: 100,
            completionTokens: 8,
          });
        });

        await ask();

        const [dispatchedAt] = usageStoreMock.recordDispatch.mock.calls[0] as [Date];
        const [, recordedAt] = usageStoreMock.recordUsage.mock.calls[0] as [unknown, Date];
        expect(dispatchedAt.getTime()).toBe(lastMoment.getTime());
        expect(recordedAt.getTime()).toBe(dispatchedAt.getTime());
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads the cap against the same day it will write to", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(lastMoment);

        await ask();

        const [readAt] = usageStoreMock.getDay.mock.calls[0] as [Date];
        expect(readAt.getTime()).toBe(lastMoment.getTime());
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /**
   * `electron-store` writes synchronously, so a full disk or a locked config
   * file throws straight out of these calls. Unguarded, the throw escaped
   * `requestAutocompleteSuggestion`, crossed IPC as a rejected `invoke`, and
   * reached the renderer as an unhandled rejection once per keystroke — where
   * the honest outcome is simply no ghost text.
   */
  describe("when the usage store fails", () => {
    const diskFull = () => {
      throw new Error("ENOSPC: no space left on device");
    };

    it("resolves to no suggestion instead of rejecting when the counter cannot be written", async () => {
      usageStoreMock.recordDispatch.mockImplementation(diskFull);

      await expect(ask()).resolves.toEqual({ requestId: 1, suggestion: null });
    });

    /**
     * An uncountable request is an uncappable one, and the cap is the only hard
     * stop between a stuck loop and an overnight bill. Refusing to dispatch
     * keeps "every dispatched request is counted" true rather than quietly
     * spending under a counter that has stopped moving.
     */
    it("does not dispatch a request it could not count", async () => {
      usageStoreMock.recordDispatch.mockImplementation(diskFull);

      await ask();

      expect(makeAIRequestMock).not.toHaveBeenCalled();
      expect(loggerMock.warn).toHaveBeenCalled();
    });

    it("leaves the previous request in flight when it refuses to dispatch", async () => {
      const signals = pendingRequests();
      void ask({ prefix: `${LONG_PREFIX} one` });
      await waitForCalls(1);
      usageStoreMock.recordDispatch.mockImplementation(diskFull);

      await ask({ prefix: `${LONG_PREFIX} two` });

      expect(signals[0].aborted).toBe(false);
    });

    it("resolves to no suggestion instead of rejecting when the day cannot be read", async () => {
      usageStoreMock.getDay.mockImplementation(diskFull);

      await expect(ask()).resolves.toEqual({ requestId: 1, suggestion: null });
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    // The suggestion is already in hand by then; throwing it away because a
    // bookkeeping write failed would turn a full disk into no ghost text.
    it("still returns the suggestion when only the usage write fails", async () => {
      usageStoreMock.recordUsage.mockImplementation(diskFull);

      await expect(ask()).resolves.toEqual({
        requestId: 1,
        suggestion: " over the lazy dog.",
      });
    });

    /**
     * Pricing the response reads a store too — `getCachedModels()` — and it sat
     * OUTSIDE the guard that exists for exactly this. A throw there escaped
     * into the caller's catch, so the suggestion already in hand was thrown
     * away and, worse, the response that had arrived was never recorded: the
     * rollup booked it as `responses: 0`, invisible to the counters whose whole
     * job is to say how much of the day is known.
     */
    describe("when the price lookup fails", () => {
      beforeEach(() => {
        getCachedModelsMock.mockImplementation(diskFull);
      });

      it("still records the response, with no knowable price", async () => {
        await ask();

        expect(usageStoreMock.recordUsage).toHaveBeenCalledWith(
          // Not a priced zero: the cost is unknown, and the store counts it as
          // an unpriced response rather than as `$0`.
          { promptTokens: 100, completionTokens: 8, estimatedCostUsd: null },
          expect.any(Date),
        );
      });

      it("still returns the suggestion", async () => {
        await expect(ask()).resolves.toEqual({
          requestId: 1,
          suggestion: " over the lazy dog.",
        });
      });

      it("warns instead of rejecting", async () => {
        await expect(ask()).resolves.toBeDefined();

        expect(loggerMock.warn).toHaveBeenCalled();
      });
    });
  });

  describe("cache bounds", () => {
    const start = new Date(2026, 6, 31, 12, 0, 0);

    const askTwice = async (gapMs: number): Promise<void> => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(start);
        await ask();
        vi.setSystemTime(new Date(start.getTime() + gapMs));
        await ask({ requestId: 2 });
      } finally {
        vi.useRealTimers();
      }
    };

    it("serves a repeat inside the TTL from cache", async () => {
      await askTwice(CACHE_TTL_MS - 1_000);

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    // Stale text is worse than a second call: the suggestion would continue a
    // document the user has since rewritten.
    it("re-requests once the entry has expired", async () => {
      await askTwice(CACHE_TTL_MS + 1_000);

      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
    });

    /**
     * The bound is what stops a long session's cache growing without limit.
     * Eviction is oldest-first, so the very first prefix is the first to go.
     */
    it("evicts the oldest entry once the bound is passed", async () => {
      const askFor = (prefix: string) =>
        requestAutocompleteSuggestion({ requestId: 1, sessionId: "window-1", prefix });

      await askFor(`${LONG_PREFIX} 0`);
      for (let index = 1; index <= CACHE_MAX_ENTRIES; index += 1) {
        await askFor(`${LONG_PREFIX} ${index}`);
      }
      const beforeRepeat = makeAIRequestMock.mock.calls.length;

      await askFor(`${LONG_PREFIX} 0`);
      await askFor(`${LONG_PREFIX} ${CACHE_MAX_ENTRIES}`);

      // The oldest was evicted and must be fetched again; the newest is still
      // cached, so it must not be.
      expect(makeAIRequestMock.mock.calls.length).toBe(beforeRepeat + 1);
    });
  });

  /**
   * A cached suggestion belongs to the BACKEND that generated it, and the model
   * ref does not identify one. Two profiles both set to `ollama::llama3.2` can
   * point `providerEndpoints.ollama.host` at different machines — different
   * weights, a different system — and for Bedrock the endpoint IS the AWS
   * region. With neither the profile id nor the endpoint in the key, anything
   * cached in the last `CACHE_TTL_MS` was replayed across the change.
   *
   * Two vectors, and the key covers both: switching profile, and editing the
   * active provider's endpoint without switching at all. Clearing the cache in
   * `profileChange.ts` would close only the first — that funnel never runs for a
   * settings edit.
   */
  describe("cache scoping to the active backend", () => {
    it("does not serve one profile's suggestion to another", async () => {
      await ask();
      currentProfileId = "profile-b";

      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["host", { host: "192.168.1.50", port: 11434 }],
      ["port", { host: "127.0.0.1", port: 11435 }],
    ])(
      "does not serve a suggestion from the %s the user just edited away from",
      async (_field, edited) => {
        providerEndpoints = { ollama: { host: "127.0.0.1", port: 11434 } };
        await ask();
        // No profile switch — the same profile, pointed somewhere else.
        providerEndpoints = { ollama: edited };

        await ask({ requestId: 2 });

        expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
      },
    );

    // The cache still has to work, or the fix is just a cost regression.
    it("still serves the same backend's own repeat from cache", async () => {
      providerEndpoints = { ollama: { host: "127.0.0.1", port: 11434 } };
      await ask();

      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    // Persisted key order is whatever the last writer left, so a reordered map
    // describes the same backend and must not cost a fresh billed call.
    it("treats a reordered endpoint map as the same backend", async () => {
      const ollama = { host: "127.0.0.1", port: 11434 };
      const lmstudio = { host: "127.0.0.1", port: 1234 };
      providerEndpoints = { ollama, lmstudio };
      await ask();
      providerEndpoints = { lmstudio, ollama };

      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });
  });

  describe("de-duplication across the prompt window", () => {
    /**
     * `buildAutocompletePrompt` keeps only the last `PREFIX_WINDOW_CHARS`
     * before the caret, so two prefixes differing only further back produce a
     * byte-identical request. Keying the cache on the raw prefix made those a
     * guaranteed miss — a fresh billed call per keystroke in a long document.
     */
    it("serves a prefix whose only difference is outside the prompt window from cache", async () => {
      const window = "x".repeat(PREFIX_WINDOW_CHARS);

      await ask({ prefix: `first paragraph ${window}` });
      await ask({ requestId: 2, prefix: `second paragraph ${window}` });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });
  });
});
