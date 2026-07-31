import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortAutocomplete,
  DAILY_REQUEST_CAP,
  MAX_OUTPUT_TOKENS,
  MIN_PREFIX_CHARS,
  requestAutocompleteSuggestion,
  resetAutocompleteState,
} from "./service";

const {
  makeAIRequestMock,
  getProfileSettingMock,
  getDefaultModelIdMock,
  usageStoreMock,
  loggerMock,
} = vi.hoisted(() => ({
  makeAIRequestMock: vi.fn(),
  getProfileSettingMock: vi.fn(),
  getDefaultModelIdMock: vi.fn(),
  usageStoreMock: { record: vi.fn(), getDay: vi.fn(), getMonth: vi.fn() },
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("~/main/ai.request/shared", () => ({
  makeAIRequest: makeAIRequestMock,
  getCachedModels: () => [],
}));
vi.mock("~/main/ai.request/cost", () => ({
  buildPriceMap: () => new Map(),
  computeCost: () => ({ status: "zero", estimatedCostUsd: 0, pricePrompt: null, priceCompletion: null }),
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  getProfileSetting: getProfileSettingMock,
  getDefaultModelId: getDefaultModelIdMock,
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

describe("requestAutocompleteSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAutocompleteState();
    getProfileSettingMock.mockImplementation((key: string) => {
      if (key === "settingsAutocomplete") return { enabled: true, model: "openai::gpt-4o-mini" };
      if (key === "settingsCorrect") return { presets: [], selectedPresetId: "" };
      return undefined;
    });
    getDefaultModelIdMock.mockReturnValue("openai::gpt-4o");
    usageStoreMock.getDay.mockReturnValue({
      date: "2026-07-31",
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
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
    const pending = () => {
      const signals: AbortSignal[] = [];
      makeAIRequestMock.mockImplementation((options: { abortSignal: AbortSignal }) => {
        signals.push(options.abortSignal);
        return new Promise(() => {
          // Never settles: the request stays in flight for the test.
        });
      });
      return signals;
    };

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

    it("aborts every surface when no session is named", async () => {
      const signals = pending();

      void ask({ sessionId: "window-1", prefix: `${LONG_PREFIX} a` });
      await waitForCalls(1);
      void ask({ sessionId: "window-2", prefix: `${LONG_PREFIX} b` });
      await waitForCalls(2);
      abortAutocomplete();

      expect(signals.every((signal) => signal.aborted)).toBe(true);
    });
  });

  describe("daily cap", () => {
    const atCap = () =>
      usageStoreMock.getDay.mockReturnValue({
        date: "2026-07-31",
        requests: DAILY_REQUEST_CAP,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
      });

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
  });

  describe("spend and logging", () => {
    it("records usage for a completed request", async () => {
      await ask();

      expect(usageStoreMock.record).toHaveBeenCalledWith(
        expect.objectContaining({ promptTokens: 100, completionTokens: 8 }),
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

    it("returns no suggestion and records nothing when the request fails", async () => {
      makeAIRequestMock.mockRejectedValue(new Error("401 unauthorized"));

      expect((await ask()).suggestion).toBeNull();
      expect(usageStoreMock.record).not.toHaveBeenCalled();
    });
  });
});
