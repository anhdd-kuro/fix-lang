import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS } from "~/features/autocomplete/shared/autocompleteDiagnostics";
import { DEFAULT_DAILY_COST_CAP_USD } from "~/features/autocomplete/shared/autocompleteSettings";
import { redactLogContext } from "~/features/logs/shared/logging";
import { GHOST_TEXT_DEBOUNCE_MS } from "~/renderer/hooks/useGhostText";
import {
  AUTOCOMPLETE_SYSTEM_PROMPT,
  CONTEXT_WINDOW_CHARS,
  PREFIX_WINDOW_CHARS,
} from "./prompt";
import {
  abortAutocomplete,
  ASK_CONTEXT_MEMORY_MAX_ENTRIES,
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  DAILY_REQUEST_BACKSTOP,
  forgetAskSession,
  MIN_PREFIX_CHARS,
  RATE_LIMIT_GLOBAL,
  RATE_LIMIT_MEMORY_MAX_ENTRIES,
  RATE_LIMIT_PER_SESSION,
  RATE_LIMIT_WINDOW_MS,
  rememberAskSession,
  requestAutocompleteSuggestion,
  resetAutocompleteState,
  RESOLUTION_MEMORY_MAX_ENTRIES,
  takeAutocompleteResolution,
} from "./service";
import type { AskContextSource } from "~/features/ask/shared/ask";
import type { LogContext } from "~/features/logs/shared/logging";

const {
  makeAIRequestMock,
  getCachedModelsMock,
  computeCostMock,
  getProfileSettingMock,
  getDefaultModelIdMock,
  getCurrentProfileIdMock,
  usageStoreMock,
  getSecretGuardSettingsMock,
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
  // Defaults to the shipped default (`confirm`), so every test in this file
  // runs with the scan ARMED rather than with the one setting that disables it
  // — a suite that silently tested `off` would prove nothing about the guard.
  getSecretGuardSettingsMock: vi.fn(() => ({ mode: "confirm", highEntropyRule: false })),
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
vi.mock("~/features/secretGuard/store/secretGuardStore", () => ({
  secretGuardStore: { getSecretGuardSettings: getSecretGuardSettingsMock },
}));
vi.mock("~/main/logging/logService", () => ({ logger: loggerMock }));

const LONG_PREFIX = "The quick brown fox jumps";
/**
 * Named for its relation to the threshold, never for its length. `"short"` was
 * a five-character literal that stopped being short the moment
 * `MIN_PREFIX_CHARS` moved 12 -> 3, and a fixture that no longer means what its
 * name says is worse than no fixture. The VALUE of the threshold is pinned
 * once, deliberately, in its own test.
 */
const BELOW_THRESHOLD = "a".repeat(MIN_PREFIX_CHARS - 1);

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

/**
 * The reply as the protocol requires it. Every test that cares about a
 * SUGGESTION goes through here rather than stubbing `content` with raw text: a
 * raw-text stub no longer means "the model suggested this", it means "the model
 * broke the contract", and the two must not be spelled the same way.
 */
const jsonReply = (suggestion: string): string[] => [JSON.stringify({ suggestion })];

const respondWith = (text: string) =>
  makeAIRequestMock.mockResolvedValue({
    content: jsonReply(text),
    model: "gpt-4o-mini",
    provider: "openai",
    promptTokens: 100,
    completionTokens: 8,
  });

/** A reply exactly as the provider returned it, contract or not. */
const respondRaw = (raw: unknown) =>
  makeAIRequestMock.mockResolvedValue({
    content: [raw],
    model: "ornith-1.0-9b",
    provider: "lmstudio",
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
 * Today's PRICED spend, and the profile's cap over it. Both are stateful for
 * the same reason `dayRequests` is: the budget is re-read from `getDay()`
 * between requests, so a fixed pair could never show a cap being crossed.
 */
let daySpendUsd = 0;
let dailyCostCapUsd = DEFAULT_DAILY_COST_CAP_USD;

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
      if (key === "settingsAutocomplete") {
        return { enabled: true, model: "openai::gpt-4o-mini", dailyCostCapUsd };
      }
      if (key === "settingsCorrect") return { presets: [], selectedPresetId: "" };
      if (key === "providerEndpoints") return providerEndpoints;
      return undefined;
    });
    getCurrentProfileIdMock.mockImplementation(() => currentProfileId);
    getDefaultModelIdMock.mockReturnValue("openai::gpt-4o");
    dayRequests = 0;
    daySpendUsd = 0;
    dailyCostCapUsd = DEFAULT_DAILY_COST_CAP_USD;
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
      estimatedCostUsd: daySpendUsd,
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

  /**
   * The one place the VALUE is pinned rather than referenced.
   *
   * Every other test here builds its fixtures from `MIN_PREFIX_CHARS`, which is
   * what keeps them meaning "the threshold" when it moves. That leaves nothing
   * at all guarding the number itself, and this one is a product decision with
   * a price attached: at 12 the threshold was most of the rate limiting, and
   * dropping it to 3 put that load onto `GHOST_TEXT_DEBOUNCE_MS` and the
   * daily stops. A silent edit back and forth here changes what the
   * feature costs, so it should have to change a test that says so.
   */
  it("keeps the deliberate 3-character threshold", () => {
    expect(MIN_PREFIX_CHARS).toBe(3);
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

  describe("system-wide scope", () => {
    const withScope = (scope: Record<string, unknown>, model = "openai::gpt-4o-mini"): void => {
      getProfileSettingMock.mockImplementation((key: string) => {
        if (key === "settingsAutocomplete") {
          return { enabled: true, model, dailyCostCapUsd, ...scope };
        }
        if (key === "settingsCorrect") return { presets: [], selectedPresetId: "" };
        if (key === "providerEndpoints") return providerEndpoints;
        return undefined;
      });
    };

    const fromApp = (bundleId: string | undefined, overrides: Record<string, unknown> = {}) =>
      ask({ surface: "system", appBundleId: bundleId, ...overrides });

    it("leaves FixLang's own window untouched by the strictest scope setting", async () => {
      withScope({ scopeMode: "allowlist", scopedApps: [], cloudScopeConsent: "" });

      expect((await ask()).suggestion).toBe(" over the lazy dog.");
      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    it("refuses an unlisted app in allowlist mode", async () => {
      withScope({ scopeMode: "allowlist", scopedApps: ["com.apple.mail"] });

      expect((await fromApp("com.apple.notes")).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    it("serves a listed app in allowlist mode", async () => {
      withScope({
        scopeMode: "allowlist",
        scopedApps: ["com.apple.mail"],
        cloudScopeConsent: "openai",
      });

      expect((await fromApp("com.apple.mail")).suggestion).toBe(" over the lazy dog.");
    });

    it("refuses a listed app in denylist mode, and serves the rest", async () => {
      withScope({
        scopeMode: "denylist",
        scopedApps: ["com.apple.mail"],
        cloudScopeConsent: "openai",
      });

      expect((await fromApp("com.apple.mail")).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();

      expect((await fromApp("com.apple.notes")).suggestion).toBe(" over the lazy dog.");
    });

    it("refuses a system surface that reported no app at all", async () => {
      withScope({ scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "openai" });

      expect((await fromApp(undefined)).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    it("refuses rather than throwing when the scope list is unreadable", async () => {
      expect((await fromApp("com.apple.notes")).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    it("refuses an unreadable list in denylist mode too, where empty would mean everywhere", async () => {
      withScope({ scopeMode: "denylist", cloudScopeConsent: "openai" });

      expect((await fromApp("com.apple.notes")).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    it("refuses a denied app even when the suggestion is already cached", async () => {
      withScope({
        scopeMode: "denylist",
        scopedApps: [],
        cloudScopeConsent: "openai",
      });

      const warm = await fromApp("com.apple.notes");
      expect(warm.suggestion).toBe(" over the lazy dog.");
      expect(makeAIRequestMock).toHaveBeenCalledOnce();

      withScope({
        scopeMode: "denylist",
        scopedApps: ["com.apple.notes"],
        cloudScopeConsent: "openai",
      });

      const denied = await fromApp("com.apple.notes");

      expect(denied.suggestion).toBeNull();
      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    describe("cloud consent", () => {
      it("serves a local provider everywhere with no consent stored", async () => {
        withScope(
          { scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "" },
          "ollama::llama3",
        );

        expect((await fromApp("com.apple.notes")).suggestion).toBe(" over the lazy dog.");
      });

      it("refuses a cloud provider everywhere with no consent stored", async () => {
        withScope({ scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "" });

        expect((await fromApp("com.apple.notes")).suggestion).toBeNull();
        expect(makeAIRequestMock).not.toHaveBeenCalled();
      });

      it("serves a cloud provider everywhere once consented", async () => {
        withScope({ scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "openai" });

        expect((await fromApp("com.apple.notes")).suggestion).toBe(" over the lazy dog.");
      });

      it("re-gates when the model moves to a different provider", async () => {
        withScope(
          { scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "ollama" },
          "openai::gpt-4o-mini",
        );

        expect((await fromApp("com.apple.notes")).suggestion).toBeNull();
        expect(makeAIRequestMock).not.toHaveBeenCalled();
      });

      it("gates allowlist mode too — naming an app is not consent to a destination", async () => {
        withScope({
          scopeMode: "allowlist",
          scopedApps: ["com.apple.notes"],
          cloudScopeConsent: "",
        });

        expect((await fromApp("com.apple.notes")).suggestion).toBeNull();
        expect(makeAIRequestMock).not.toHaveBeenCalled();
      });

      it("serves an allowlisted app once its provider is consented to", async () => {
        withScope({
          scopeMode: "allowlist",
          scopedApps: ["com.apple.notes"],
          cloudScopeConsent: "openai",
        });

        expect((await fromApp("com.apple.notes")).suggestion).toBe(" over the lazy dog.");
      });
    });

    describe("what it says about itself", () => {
      const scopeLines = (): LogContext[] =>
        [...loggerMock.debug.mock.calls, ...loggerMock.warn.mock.calls]
          .map((call) => call[2] as LogContext)
          .filter((context) =>
            [
              "app-not-allowed",
              "app-excluded",
              "app-unidentified",
              "scope-unreadable",
              "cloud-consent-missing",
            ].includes(String(context.reason)),
          );

      it("names the app and the mode on an allowlist refusal", async () => {
        withScope({ scopeMode: "allowlist", scopedApps: [] });

        await fromApp("com.apple.notes");

        expect(scopeLines()[0]).toMatchObject({
          reason: "app-not-allowed",
          bundleId: "com.apple.notes",
          scopeMode: "allowlist",
        });
      });

      it("names the app and the mode on a denylist refusal", async () => {
        withScope({
          scopeMode: "denylist",
          scopedApps: ["com.apple.notes"],
          cloudScopeConsent: "openai",
        });

        await fromApp("com.apple.notes");

        expect(scopeLines()[0]).toMatchObject({
          reason: "app-excluded",
          bundleId: "com.apple.notes",
          scopeMode: "denylist",
        });
      });

      it("warns when the surface reported no app", async () => {
        withScope({ scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "openai" });

        await fromApp(undefined);

        expect(loggerMock.warn).toHaveBeenCalled();
        expect(scopeLines()[0]).toMatchObject({ reason: "app-unidentified", bundleId: null });
      });

      it("warns about a missing cloud consent, naming both providers", async () => {
        withScope(
          { scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "ollama" },
          "openai::gpt-4o-mini",
        );

        await fromApp("com.apple.notes");

        expect(loggerMock.warn).toHaveBeenCalled();
        expect(scopeLines()[0]).toMatchObject({
          reason: "cloud-consent-missing",
          provider: "openai",
          consentedProvider: "ollama",
        });
      });

      it("emits only context keys that survive the real redactor", async () => {
        withScope({ scopeMode: "allowlist", scopedApps: [] });

        await fromApp("com.apple.notes");

        const context = scopeLines()[0] ?? {};
        expect(redactLogContext(context)).toEqual(context);
        expect(Object.keys(context).length).toBeGreaterThan(1);
      });

      it("carries no typed text on any scope refusal", async () => {
        withScope(
          { scopeMode: "denylist", scopedApps: [], cloudScopeConsent: "ollama" },
          "openai::gpt-4o-mini",
        );

        await fromApp("com.apple.notes");

        const serialized = JSON.stringify(scopeLines());
        expect(serialized).not.toContain(LONG_PREFIX);
      });
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
    it("forces reasoning off and stays quiet", async () => {
      await ask();

      expect(makeAIRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: "none", quiet: true }),
      );
    });

    /**
     * NO OUTPUT CEILING, by explicit decision: the model decides how long the
     * reply is and the system prompt asks for one short sentence.
     *
     * The key must be ABSENT, not `undefined`-valued — the two are only
     * interchangeable because every provider spreads it conditionally
     * (`options.maxOutputTokens !== undefined ? … : {}`), and Ollama maps it to
     * `options.num_predict` where a value that leaks through would become a hard
     * per-call token limit on a local model rather than a no-op. Asserting
     * absence pins the shape that survives all five request builders.
     */
    it("sends no output-token ceiling to the provider", async () => {
      await ask();

      const [options] = makeAIRequestMock.mock.calls[0];
      expect(options.maxOutputTokens).toBeUndefined();
      expect(Object.keys(options)).not.toContain("maxOutputTokens");
    });

    /**
     * No stop sequence at all, where `["\n\n"]` used to be. It cannot fire
     * inside the envelope (a newline in the suggestion is an escape, not a line
     * break) so it saves nothing on a rambling model; it CAN fire on one that
     * pretty-prints with a blank line, and firing there removes the closing
     * brace and turns a reply that would have parsed into no suggestion.
     */
    it("sends no stop sequence, which could only truncate a valid envelope", async () => {
      await ask();

      const [options] = makeAIRequestMock.mock.calls[0];
      expect(options.stop).toBeUndefined();
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

  describe("daily spend cap", () => {
    const atCap = () => {
      daySpendUsd = dailyCostCapUsd;
    };

    it("stops making requests once today's spend reaches the cap", async () => {
      atCap();

      expect((await ask()).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    it("keeps making requests while spend is under the cap", async () => {
      daySpendUsd = dailyCostCapUsd - 0.01;

      expect((await ask()).suggestion).not.toBeNull();
      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    // The cap is a PROFILE setting, so a profile with a bigger budget must not
    // inherit the one that happened to be active first.
    it("reads the cap from the active profile, not a constant", async () => {
      dailyCostCapUsd = 0.5;
      daySpendUsd = 1;

      expect((await ask()).suggestion).toBeNull();

      dailyCostCapUsd = 2;

      expect((await ask({ requestId: 2, prefix: `${LONG_PREFIX} more` })).suggestion).not.toBeNull();
    });

    /**
     * `>=`, not `>`. A cap of zero means "spend nothing", and that reading has
     * to hold from the first request — before any spend exists to exceed it.
     * Under `>` a zero cap would wave through every request whose predecessors
     * all happened to be free, which is exactly the local-provider case.
     */
    it("refuses everything at a cap of zero, before any spend is recorded", async () => {
      dailyCostCapUsd = 0;
      daySpendUsd = 0;

      expect((await ask()).suggestion).toBeNull();
      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    /**
     * The hole the backstop exists for, stated as a test so it cannot be
     * mistaken for an oversight. A local provider bills a genuine `$0`, so a
     * runaway against Ollama never moves the budget and the money cap alone
     * would let it run all day.
     */
    it("does not fire for a day of genuinely free responses", async () => {
      daySpendUsd = 0;

      expect((await ask()).suggestion).not.toBeNull();
      expect(makeAIRequestMock).toHaveBeenCalledOnce();
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
      dayRequests = DAILY_REQUEST_BACKSTOP - 2;
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

    it("does not count a request the spend cap itself refused", async () => {
      atCap();

      await ask();

      expect(usageStoreMock.recordDispatch).not.toHaveBeenCalled();
    });

    it.each([
      ["the feature is disabled", { enabled: false, model: "openai::gpt-4o-mini" }, LONG_PREFIX],
      [
        "the prefix is too short",
        { enabled: true, model: "openai::gpt-4o-mini" },
        BELOW_THRESHOLD,
      ],
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

  /**
   * The short-window backstop. The spend cap says what a day may cost;
   * this says how fast that budget may be spent, which until now was decided
   * entirely by a renderer main does not trust — `sessionId` is derived from
   * `event.sender.id` precisely because of that, while the RATE was left to a
   * debounce living in `useGhostText.ts`.
   *
   * The load-bearing test here is the human-typing one. A limit an ordinary
   * user can trip is not a guard, it is a feature that stops working for no
   * stated reason, and it would look exactly like the silent-refusal bugs the
   * whole diagnostics pass above was written to end.
   */
  describe("short-window rate limit", () => {
    const FROZEN = new Date(2026, 6, 31, 12, 0, 0);

    const atFrozenClock = async (body: (setNow: (ms: number) => void) => Promise<void>) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(FROZEN);
        await body((ms) => vi.setSystemTime(new Date(FROZEN.getTime() + ms)));
      } finally {
        vi.useRealTimers();
      }
    };

    /** Distinct every time, so nothing is answered from cache. */
    const askFresh = (index: number, sessionId = "window-1") =>
      requestAutocompleteSuggestion({
        requestId: index,
        sessionId,
        prefix: `${LONG_PREFIX} ${index}`,
      });

    const rateLimitedLines = (): LogContext[] =>
      [...loggerMock.debug.mock.calls, ...loggerMock.warn.mock.calls]
        .map((call) => call[2] as LogContext)
        .filter((context) => context.reason === "rate-limited");

    /**
     * The arithmetic, pinned against the constant it is derived from rather
     * than against the numbers themselves.
     *
     * The debounce is trailing and rearms on every change, so a
     * correctly-working surface cannot dispatch faster than one request per
     * `GHOST_TEXT_DEBOUNCE_MS` — a hard ceiling per window, reached by a steady
     * ~40 WPM typist whose gaps sit just above the debounce. The session limit
     * has to stay clear of that ceiling for the guard to be unreachable by
     * typing; the global one has to clear a surface spending its WHOLE
     * allowance plus another typing flat out, or one window's runaway starves a
     * second window's real user.
     */
    it("leaves headroom over the fastest rate the debounce can produce", () => {
      const perWindowCeiling = Math.ceil(RATE_LIMIT_WINDOW_MS / GHOST_TEXT_DEBOUNCE_MS);

      expect(RATE_LIMIT_PER_SESSION).toBeGreaterThanOrEqual(perWindowCeiling * 2);
      expect(RATE_LIMIT_GLOBAL).toBeGreaterThanOrEqual(
        RATE_LIMIT_PER_SESSION + perWindowCeiling,
      );
    });

    /**
     * THE ONE THAT MATTERS. Not a leisurely typist but the worst legitimate
     * case: every keystroke separated by just over the debounce, so every
     * single one dispatches, sustained for a minute without a pause. Nothing
     * here may be refused.
     */
    it("never refuses a human typing at the fastest cadence the debounce permits", async () => {
      const presses = Math.ceil(60_000 / GHOST_TEXT_DEBOUNCE_MS);

      await atFrozenClock(async (setNow) => {
        for (let press = 0; press < presses; press += 1) {
          setNow(press * GHOST_TEXT_DEBOUNCE_MS);
          await askFresh(press);
        }
      });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(presses);
      expect(rateLimitedLines()).toEqual([]);
    });

    it("refuses a burst once the surface has spent its window", async () => {
      await atFrozenClock(async () => {
        for (let press = 0; press < RATE_LIMIT_PER_SESSION * 3; press += 1) {
          await askFresh(press);
        }
      });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_PER_SESSION);
    });

    /**
     * A refused request was never asked for, so it must not walk the daily
     * counter up: the cap reads the same number the rate limit just protected.
     */
    it("counts no dispatch for a request it refused", async () => {
      await atFrozenClock(async () => {
        for (let press = 0; press < RATE_LIMIT_PER_SESSION * 3; press += 1) {
          await askFresh(press);
        }
      });

      expect(usageStoreMock.recordDispatch).toHaveBeenCalledTimes(RATE_LIMIT_PER_SESSION);
    });

    it("admits again once the window has elapsed", async () => {
      await atFrozenClock(async (setNow) => {
        for (let press = 0; press < RATE_LIMIT_PER_SESSION + 5; press += 1) {
          await askFresh(press);
        }
        expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_PER_SESSION);

        setNow(RATE_LIMIT_WINDOW_MS);
        await askFresh(9_000);
      });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_PER_SESSION + 1);
    });

    /**
     * An NTP correction or a user changing the date moves the clock backward,
     * which makes the elapsed time negative — and negative reads as "not
     * expired yet". Left alone, an hour's jump would keep a spent window shut
     * for an hour, i.e. turn the guard into an outage with nothing on screen to
     * explain it.
     */
    it("reopens a spent window when the clock jumps backward", async () => {
      await atFrozenClock(async (setNow) => {
        for (let press = 0; press < RATE_LIMIT_PER_SESSION + 5; press += 1) {
          await askFresh(press);
        }
        expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_PER_SESSION);

        setNow(-60 * 60 * 1000);
        await askFresh(9_000);
      });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_PER_SESSION + 1);
    });

    /**
     * A per-surface limit alone does not bound spend — one more window (a
     * composer is planned) and the ceiling doubles. The global window is the
     * one that says what the ACCOUNT may spend per interval.
     */
    it("bounds every surface together, not each one on its own", async () => {
      const surfaces = 8;
      const perSurface = RATE_LIMIT_PER_SESSION - 5;

      await atFrozenClock(async () => {
        let index = 0;
        for (let round = 0; round < perSurface; round += 1) {
          for (let surface = 0; surface < surfaces; surface += 1) {
            index += 1;
            await askFresh(index, `window-${surface}`);
          }
        }
      });

      // No surface came close to its own limit; the global one is what refused.
      expect(perSurface).toBeLessThan(RATE_LIMIT_PER_SESSION);
      expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_GLOBAL);
      expect(rateLimitedLines()[0]).toMatchObject({ limitScope: "global" });
    });

    /**
     * The session map is bounded, so it is evicted — and an evictable counter
     * keyed by something the caller can churn is a counter the caller can
     * clear. A loop that opened a fresh surface per request would walk its own
     * bucket out of the map every time; only the global window, which is keyed
     * by nothing, survives that.
     */
    it("cannot be evaded by churning session ids past the memory bound", async () => {
      const attempts = RATE_LIMIT_GLOBAL * 3;

      await atFrozenClock(async () => {
        for (let index = 0; index < attempts; index += 1) {
          await askFresh(index, `window-${index}`);
        }
      });

      expect(attempts).toBeGreaterThan(RATE_LIMIT_MEMORY_MAX_ENTRIES);
      expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_GLOBAL);
    });

    /**
     * THE ORDERING TRAP. A cache hit calls no provider and returns text already
     * paid for, so it is the cheapest path there is; charging it would punish
     * exactly the motion `CACHE_TTL_MS` exists to serve — backspacing back over
     * a phrase answered seconds ago.
     */
    it("spends nothing on a suggestion served from cache", async () => {
      const cached = `${LONG_PREFIX} already answered`;

      await atFrozenClock(async () => {
        await ask({ requestId: 0, prefix: cached });
        for (let repeat = 0; repeat < RATE_LIMIT_PER_SESSION * 3; repeat += 1) {
          await ask({ requestId: repeat + 1, prefix: cached });
        }
        // The window is untouched, so a genuinely new prefix still dispatches.
        await ask({ requestId: 9_000, prefix: `${LONG_PREFIX} new` });
      });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
      expect(rateLimitedLines()).toEqual([]);
    });

    it("still serves the cache after the window is spent", async () => {
      const cached = `${LONG_PREFIX} already answered`;

      await atFrozenClock(async () => {
        await ask({ requestId: 0, prefix: cached });
        for (let press = 0; press < RATE_LIMIT_PER_SESSION * 2; press += 1) {
          await askFresh(press + 1);
        }

        expect(await ask({ requestId: 9_000, prefix: cached })).toEqual({
          requestId: 9_000,
          suggestion: " over the lazy dog.",
        });
      });
    });

    /**
     * Refusing without aborting, for the same reason `countDispatch`'s refusal
     * does: this path has no suggestion to offer, so killing the request
     * already running would make room for one that is never sent.
     */
    it("leaves the in-flight request alone when it refuses", async () => {
      await atFrozenClock(async () => {
        const signals = pendingRequests();
        for (let press = 0; press < RATE_LIMIT_PER_SESSION; press += 1) {
          void askFresh(press);
          await waitForCalls(press + 1);
        }
        // The window is spent; everything from here is refused.
        for (let refused = 0; refused < 5; refused += 1) {
          await askFresh(9_000 + refused);
        }

        // The last ADMITTED request is still open, and the refusals that
        // followed it made room for nothing, so they must not have killed it.
        expect(makeAIRequestMock).toHaveBeenCalledTimes(RATE_LIMIT_PER_SESSION);
        expect(signals[RATE_LIMIT_PER_SESSION - 1].aborted).toBe(false);
      });
    });

    /**
     * `warn`, not `debug`. No amount of typing can reach this limit, so a line
     * here is our own bug or something pathological — and `debug` is the level
     * most readers filter out, which is the one place a runaway must not hide.
     */
    describe("what it says about itself", () => {
      const burst = () =>
        atFrozenClock(async () => {
          for (let press = 0; press < RATE_LIMIT_PER_SESSION * 5; press += 1) {
            await askFresh(press);
          }
        });

      it("warns, with the scope, the limit and the window it measured", async () => {
        await burst();

        expect(loggerMock.warn.mock.calls[0]?.[2]).toMatchObject({
          reason: "rate-limited",
          limitScope: "session",
          limit: RATE_LIMIT_PER_SESSION,
          windowMs: RATE_LIMIT_WINDOW_MS,
          dispatchesInWindow: RATE_LIMIT_PER_SESSION,
        });
      });

      /**
       * A loop trips this thousands of times, and every one of those lines
       * would land in `userData/logs/*.jsonl`. Unthrottled, the diagnostic
       * becomes the second copy of the problem it was added to report.
       */
      it("says it once however many requests are refused", async () => {
        await burst();

        expect(rateLimitedLines()).toHaveLength(1);
      });

      it("says it again once the throttle interval has passed, counting what it swallowed", async () => {
        await atFrozenClock(async (setNow) => {
          for (let press = 0; press < RATE_LIMIT_PER_SESSION + 5; press += 1) {
            await askFresh(press);
          }
          setNow(AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS);
          for (let press = 0; press < RATE_LIMIT_PER_SESSION + 5; press += 1) {
            await askFresh(press + 10_000);
          }
        });

        expect(rateLimitedLines()).toHaveLength(2);
        expect(rateLimitedLines()[1]).toMatchObject({
          reason: "rate-limited",
          suppressedSincePrevious: 4,
        });
      });

      /**
       * `redactLogContext` blanks any key merely CONTAINING `clipboard`,
       * `token`, `secret` or `selected_text`, silently and with no error — the
       * `selectionPoll` trap. A blanked `limit` or `dispatchesInWindow` would
       * leave a warning that says a runaway happened and refuses to say how big.
       */
      it("emits only context keys that survive the real redactor", async () => {
        await burst();

        const context = rateLimitedLines()[0] ?? {};
        expect(redactLogContext(context)).toEqual(context);
        expect(Object.keys(context).length).toBeGreaterThan(1);
      });

      it("carries no typed text, only counts and limits", async () => {
        const prefix = "my private unsent sentence about a medical result";

        await atFrozenClock(async () => {
          for (let press = 0; press < RATE_LIMIT_PER_SESSION + 5; press += 1) {
            await ask({ requestId: press, prefix: `${prefix} ${press}` });
          }
        });

        const everythingLogged = JSON.stringify([
          ...loggerMock.debug.mock.calls,
          ...loggerMock.info.mock.calls,
          ...loggerMock.warn.mock.calls,
          ...loggerMock.error.mock.calls,
        ]);
        expect(everythingLogged).not.toContain(prefix);
        expect(everythingLogged).not.toContain("private");
        expect(everythingLogged).not.toContain("medical");
      });
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
          content: jsonReply(" over the lazy dog."),
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
          content: jsonReply(" over the lazy dog."),
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
          content: jsonReply(" over the lazy dog."),
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
          content: jsonReply(" over the lazy dog."),
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
        content: jsonReply(" over the lazy dog."),
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
            content: jsonReply(" over the lazy dog."),
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
     *
     * CLOCK-DRIVEN, and it has to be. Filling the cache means dispatching
     * `CACHE_MAX_ENTRIES + 1` requests, and the short-window rate limit refuses
     * anything past `RATE_LIMIT_PER_SESSION` a second — a burst at machine speed
     * is now precisely what that guard exists to stop, so this test would be
     * measuring the limiter rather than the cache. The step is chosen to clear
     * BOTH bounds at once: comfortably under the limiter's rate, and the whole
     * fill still finishing inside `CACHE_TTL_MS`, so the oldest entry is missing
     * because it was EVICTED and not because it expired. A step that overran the
     * TTL would leave this passing for the wrong reason, with the eviction loop
     * itself untested.
     */
    it("evicts the oldest entry once the bound is passed", async () => {
      const stepMs = 130;
      const askFor = (prefix: string) =>
        requestAutocompleteSuggestion({ requestId: 1, sessionId: "window-1", prefix });

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        let elapsed = 0;
        const tick = async (prefix: string) => {
          vi.setSystemTime(new Date(start.getTime() + elapsed));
          elapsed += stepMs;
          await askFor(prefix);
        };

        await tick(`${LONG_PREFIX} 0`);
        for (let index = 1; index <= CACHE_MAX_ENTRIES; index += 1) {
          await tick(`${LONG_PREFIX} ${index}`);
        }
        const beforeRepeat = makeAIRequestMock.mock.calls.length;
        // Every fill request really was dispatched: nothing was rate-limited,
        // so the cache genuinely holds `CACHE_MAX_ENTRIES + 1` entries' worth.
        expect(beforeRepeat).toBe(CACHE_MAX_ENTRIES + 1);
        // Still inside the TTL, so expiry cannot be what removes the oldest.
        expect(elapsed).toBeLessThan(CACHE_TTL_MS);

        await tick(`${LONG_PREFIX} 0`);
        await tick(`${LONG_PREFIX} ${CACHE_MAX_ENTRIES}`);

        // The oldest was evicted and must be fetched again; the newest is still
        // cached, so it must not be.
        expect(makeAIRequestMock.mock.calls.length).toBe(beforeRepeat + 1);
      } finally {
        vi.useRealTimers();
      }
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

  /**
   * THE SECRET SCAN, which is the only guard shape that fits this surface.
   *
   * `SECRET_SEND_SITE_POLICY` gives Ask a `confirm` at SUBMIT — and as of
   * 0.23.0 that is too late for this path, because ghost-text requests carry
   * the ATTACHED Ask context, so the user's selection reaches a provider once
   * per debounce interval long before there is anything to submit. A modal is
   * categorically impossible per keystroke, so autocomplete refuses to
   * dispatch instead of asking.
   */
  describe("the secret scan", () => {
    // Assembled rather than written out, so the file itself never contains a
    // contiguous credential-shaped literal for a scanner to flag.
    const fakeAwsKeyId = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

    // `vi.clearAllMocks()` in the outer `beforeEach` clears CALLS, not
    // implementations, so the `mode: "off"` case below would otherwise leak
    // into every test declared after it and silently disarm them.
    beforeEach(() => {
      getSecretGuardSettingsMock.mockReturnValue({ mode: "confirm", highEntropyRule: false });
    });

    it("dispatches nothing when the text around the caret looks like a credential", async () => {
      await ask({ prefix: `my key is ${fakeAwsKeyId}` });

      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    /**
     * The half of this that actually matters. The typed prefix is FixLang's
     * own window; the attached context is the user's selection or clipboard,
     * and it rides every request without them typing a character of it.
     */
    it("dispatches nothing when the ATTACHED context contains one, even on an innocuous prefix", async () => {
      rememberAskSession("window-1", {
        context: { text: `deploy key ${fakeAwsKeyId}`, source: "selection" },
      });

      await ask({ prefix: LONG_PREFIX });

      expect(makeAIRequestMock).not.toHaveBeenCalled();
    });

    /**
     * ABOVE the cache, unlike every other refusal in this function. The others
     * are about cost, and a cache hit costs nothing; this one is about what
     * leaves the machine, and it has to hold for as long as the credential is
     * on screen rather than until the first reply for that prefix is cached.
     */
    it("refuses a prefix whose suggestion is already cached", async () => {
      const prefix = `${LONG_PREFIX} over`;
      await ask({ prefix });
      expect(makeAIRequestMock).toHaveBeenCalledOnce();

      rememberAskSession("window-1", {
        context: { text: fakeAwsKeyId, source: "clipboard" },
      });
      const result = await ask({ requestId: 2, prefix });

      expect(result.suggestion).toBeNull();
      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    it("dispatches normally when the secret guard is off", async () => {
      getSecretGuardSettingsMock.mockReturnValue({ mode: "off", highEntropyRule: false });

      await ask({ prefix: `my key is ${fakeAwsKeyId}` });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    it("still dispatches when only the environment block looks like a credential, but redacts that span", async () => {
      rememberAskSession("window-1", {
        environment: [
          "App locale: en",
          "Recent transforms (most recent first, names and times only):",
          `- ${fakeAwsKeyId} (2026-08-11T05:28:00.000Z)`,
        ].join("\n"),
      });

      await ask({ prefix: LONG_PREFIX });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
      const systemPrompt = makeAIRequestMock.mock.calls[0][0].systemPrompt as string;
      expect(systemPrompt).not.toContain(fakeAwsKeyId);
      expect(systemPrompt).toContain("[redacted]");
    });

    /**
     * `redactSecretsIrreversibly` ignores `maskable`. The assignment rule stops
     * at the first space, so a naive redact would send `password=[redacted] Horse
     * Battery`. Prefix/context refuse; environment must too when the scan is
     * not fully maskable.
     */
    it.each(["confirm", "mask"] as const)(
      "refuses an unmaskable environment assignment span in %s mode",
      async (mode) => {
        getSecretGuardSettingsMock.mockReturnValue({ mode, highEntropyRule: false });
        rememberAskSession("window-1", {
          environment: [
            "App locale: en",
            "Recent transforms (most recent first, names and times only):",
            "- password=Correct Horse Battery (2026-08-11T05:28:00.000Z)",
          ].join("\n"),
        });

        await ask({ prefix: LONG_PREFIX });

        expect(makeAIRequestMock).not.toHaveBeenCalled();
      },
    );

    it("sends a secret-shaped environment name unchanged when the guard is off", async () => {
      getSecretGuardSettingsMock.mockReturnValue({ mode: "off", highEntropyRule: false });
      rememberAskSession("window-1", {
        environment: `- ${fakeAwsKeyId} (2026-08-11T05:28:00.000Z)`,
      });

      await ask({ prefix: LONG_PREFIX });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
      const systemPrompt = makeAIRequestMock.mock.calls[0][0].systemPrompt as string;
      expect(systemPrompt).toContain(fakeAwsKeyId);
    });

    /**
     * `warn`, because this is the one skip the user can be actively harmed by
     * not knowing about: it fires while they type something credential-shaped
     * and the ghost simply stops appearing.
     *
     * The rule ids are an array VALUE. Spread as KEYS — `{[ruleId]: 1}` —
     * `redactLogContext` would blank exactly the ones whose names contain
     * `key`/`token`/`secret` and silently keep the rest, so the mistake looks
     * like it worked in half the cases. Nothing here carries a length either:
     * on a prefix that is mostly one credential, that is most of a fingerprint.
     */
    it("warns with the rule ids and not one character of the text", async () => {
      await ask({ prefix: `my key is ${fakeAwsKeyId}` });

      const context = loggerMock.warn.mock.calls
        .map(([, , logContext]) => logContext as LogContext)
        .find((logContext) => logContext?.reason === "secret-in-text");
      expect(context).toBeDefined();
      expect(context).toMatchObject({
        reason: "secret-in-text",
        ruleIds: ["aws-access-key-id"],
      });
      expect(redactLogContext(context ?? {})).toEqual(context);
      expect(JSON.stringify(context)).not.toContain(fakeAwsKeyId);
    });
  });

  /**
   * THE ATTACHED ASK CONTEXT, which reaches the provider WITHOUT crossing the
   * wire.
   *
   * `showAskInputWindow` records the passage against the window's
   * `webContents.id`, and this is the same string `autocomplete-suggest` derives
   * its `sessionId` from — so the renderer supplies nothing, which is the point:
   * a context field on the wire request would be renderer-controlled text going
   * straight into a provider prompt, and `sessionId` is derived from the sender
   * precisely because the renderer is not trusted.
   */
  describe("the attached Ask context", () => {
    const sentPrompt = (call = 0): string =>
      makeAIRequestMock.mock.calls[call][0].userPrompt as string;

    const sentSystemPrompt = (call = 0): string =>
      makeAIRequestMock.mock.calls[call][0].systemPrompt as string;

    const attach = (text: string, source: AskContextSource = "selection"): void =>
      rememberAskSession("window-1", { context: { text, source } });

    it("sends the passage the window has attached", async () => {
      attach("The deploy slipped to Friday.");

      await ask();

      expect(sentPrompt()).toContain("The deploy slipped to Friday.");
      expect(sentPrompt()).toContain("Context the user attached (selected text):");
    });

    /**
     * The passage rides the USER prompt, never the system one: the system prompt
     * is the short, stable, cacheable prefix, and a per-press passage in it would
     * change on every ask and cost the prefix cache on every provider that has
     * one.
     */
    it("leaves the system prompt untouched", async () => {
      attach("The deploy slipped to Friday.");

      await ask();

      expect(sentSystemPrompt()).toBe(AUTOCOMPLETE_SYSTEM_PROMPT);
      expect(sentSystemPrompt()).not.toContain("The deploy slipped to Friday.");
    });

    /**
     * THE CACHE KEY, which is the reason the passage belongs in the user prompt
     * rather than being spliced in later: the key is hashed from that exact
     * string. Keyed without it, the same half-typed question asked over a
     * DIFFERENT selection would be served the first selection's suggestion —
     * silently, and for `CACHE_TTL_MS`.
     */
    it("makes an identical prefix over a different passage a fresh request", async () => {
      attach("First selection.");
      await ask();

      attach("Second selection.");
      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
    });

    it("still serves an identical prefix over the same passage from cache", async () => {
      attach("Same selection.");

      await ask();
      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    /**
     * Windowed from the HEAD, unlike the prefix: the passage is not
     * caret-relative and its opening is what identifies its subject.
     */
    it("windows an overlong passage from its head", async () => {
      attach(`HEAD${"x".repeat(CONTEXT_WINDOW_CHARS)}TAIL`);

      await ask();

      expect(sentPrompt()).toContain("HEAD");
      expect(sentPrompt()).not.toContain("TAIL");
    });

    /**
     * WITH NOTHING ATTACHED THE REQUEST IS BYTE-IDENTICAL TO WHAT IT WAS, which
     * is what "preserves current behaviour" has to mean here — a bare question
     * keeps the cheap path it already had, cache entries included.
     */
    it("sends exactly the pre-context prompt when nothing is attached", async () => {
      await ask();
      attach("A selection.");
      forgetAskSession("window-1");
      await ask({ requestId: 2, prefix: `${LONG_PREFIX} again` });

      expect(sentPrompt(0)).not.toContain("Context the user attached");
      expect(sentPrompt(1)).not.toContain("Context the user attached");
      expect(sentPrompt(0).startsWith("Text before the caret:")).toBe(true);
    });

    it("keeps one surface's passage out of another surface's prompt", async () => {
      attach("Window one's selection.");

      await ask({ sessionId: "window-2" });

      expect(sentPrompt()).not.toContain("Window one's selection.");
    });

    /**
     * REPLACED on every press, not merged: a passage that outlived its press is
     * the failure the input window's `From clipboard` label exists to make
     * visible, and here there would be nothing on screen to see.
     */
    it("replaces the passage rather than accumulating", async () => {
      attach("Old selection.");
      attach("New selection.");

      await ask();

      expect(sentPrompt()).toContain("New selection.");
      expect(sentPrompt()).not.toContain("Old selection.");
    });

    // Bounded for the same reason `lastResolutions` is: the key is an
    // ever-increasing `webContents.id`, so an unbounded map keyed by one leaks
    // with nothing to show it. LRU, so the surface being used is never the one
    // dropped.
    it("bounds how many surfaces' passages it remembers, evicting the coldest", async () => {
      attach("Oldest surface's selection.");
      for (let index = 0; index < ASK_CONTEXT_MEMORY_MAX_ENTRIES; index += 1) {
        rememberAskSession(`other-${index}`, {
          context: { text: `filler ${index}`, source: "selection" },
        });
      }

      await ask();

      expect(sentPrompt()).not.toContain("Oldest surface's selection.");
    });

    describe("what it says about itself", () => {
      const resolvedLine = (): LogContext =>
        (loggerMock.debug.mock.calls.find(
          (call) => call[1] === "Suggestion resolved",
        )?.[2] ?? {}) as LogContext;

      it("states how much context went out and where it came from", async () => {
        attach("Older clipboard text.", "clipboard");

        await ask();

        expect(resolvedLine()).toMatchObject({
          contextLength: "Older clipboard text.".length,
          contextSource: "clipboard",
        });
      });

      // What was SENT, not what was attached: the windowed length is the honest
      // number on a line whose whole job is saying what left the machine.
      it("states the windowed length, not the attached one", async () => {
        attach("y".repeat(CONTEXT_WINDOW_CHARS + 500));

        await ask();

        expect(resolvedLine().contextLength).toBe(CONTEXT_WINDOW_CHARS);
      });

      it("reports a zero length and no source when nothing was attached", async () => {
        await ask();

        expect(resolvedLine().contextLength).toBe(0);
        expect(resolvedLine()).not.toHaveProperty("contextSource");
      });

      /**
       * `redactLogContext` blanks any key merely CONTAINING `clipboard`,
       * `token`, `secret` or `selected_text`, silently and with no error — so
       * `clipboardContext` or `selectedText` would have persisted as
       * `"[REDACTED]"` and the two fields that describe this widening would have
       * said nothing. Run through the REAL redactor, not eyeballed.
       */
      it("emits context keys that survive the real redactor", async () => {
        attach("Older clipboard text.", "clipboard");

        await ask();

        const context = resolvedLine();
        expect(redactLogContext(context)).toEqual(context);
        expect(context).toHaveProperty("contextLength");
        expect(context).toHaveProperty("contextSource");
      });

      /**
       * The passage is the user's own text and these lines are copyable and
       * exportable from the Logs tab — the same rule the prefix and the
       * suggestion already follow. Lengths and the source only.
       */
      it("never writes the passage itself into a log line", async () => {
        const passage = "a private clinic letter the user merely had selected";
        attach(passage);

        await ask();

        const everythingLogged = JSON.stringify([
          ...loggerMock.debug.mock.calls,
          ...loggerMock.info.mock.calls,
          ...loggerMock.warn.mock.calls,
          ...loggerMock.error.mock.calls,
        ]);
        expect(everythingLogged).not.toContain(passage);
        expect(everythingLogged).not.toContain("clinic");
      });
    });
  });

  /**
   * THE PRESS ENVIRONMENT — the app locale, the system language, the keyboard
   * input source, the press time and the recent preset names, rendered once at
   * the hotkey by `askEnvironment.ts` and stashed here alongside the passage.
   *
   * It rides the same route and for the same reasons: the renderer cannot
   * resolve any of it, and a field on the wire request would be
   * renderer-controlled text going into a provider prompt.
   */
  describe("the press environment", () => {
    const sentUserPrompt = (call = 0): string =>
      makeAIRequestMock.mock.calls[call][0].userPrompt as string;

    const sentSystemPrompt = (call = 0): string =>
      makeAIRequestMock.mock.calls[call][0].systemPrompt as string;

    const ENVIRONMENT = [
      "App locale: en",
      "Keyboard input source: Japanese",
      "Current time: 2026-08-11T14:32:05+09:00 (Asia/Tokyo)",
    ].join("\n");

    const attachEnvironment = (environment = ENVIRONMENT): void =>
      rememberAskSession("window-1", { environment });

    it("sends the block the press resolved", async () => {
      attachEnvironment();

      await ask();

      expect(sentSystemPrompt()).toContain("Keyboard input source: Japanese");
      expect(sentUserPrompt()).not.toContain("Keyboard input source: Japanese");
    });

    it("sends it alongside an attached passage rather than instead of one", async () => {
      rememberAskSession("window-1", {
        context: { text: "The deploy slipped to Friday.", source: "selection" },
        environment: ENVIRONMENT,
      });

      await ask();

      expect(sentUserPrompt()).toContain("The deploy slipped to Friday.");
      expect(sentSystemPrompt()).toContain("App locale: en");
    });

    /**
     * THE CACHE KEY, hashed from the user prompt alone — so this lands in it for
     * free, and the same half-typed question asked in a different keyboard
     * layout (or hours later) cannot be served the earlier one's suggestion.
     */
    it("makes an identical prefix under a different environment a fresh request", async () => {
      attachEnvironment();
      await ask();

      attachEnvironment(ENVIRONMENT.replace("Japanese", "ABC"));
      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledTimes(2);
    });

    it("still serves an identical prefix under the same environment from cache", async () => {
      attachEnvironment();

      await ask();
      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
    });

    /**
     * WITH NEITHER BLOCK THE REQUEST IS BYTE-IDENTICAL TO WHAT IT WAS — the cost
     * property, not a tidiness one: a bare question keeps the cheap path it
     * already had, cache entries included.
     */
    it("sends exactly the pre-environment prompt when the press resolved none", async () => {
      await ask();

      expect(sentSystemPrompt(0)).not.toContain("Environment at the time of the request");
      expect(sentUserPrompt(0).startsWith("Text before the caret:")).toBe(true);
    });

    it("keeps one surface's environment out of another surface's prompt", async () => {
      attachEnvironment();

      await ask({ sessionId: "window-2" });

      expect(sentSystemPrompt()).not.toContain("Keyboard input source: Japanese");
    });

    describe("what it says about itself", () => {
      const resolvedLine = (): LogContext =>
        (loggerMock.debug.mock.calls.find(
          (call) => call[1] === "Suggestion resolved",
        )?.[2] ?? {}) as LogContext;

      it("states how much of the block went out", async () => {
        attachEnvironment();

        await ask();

        expect(resolvedLine().environmentLength).toBe(ENVIRONMENT.length);
      });

      it("reports zero when the press resolved no environment", async () => {
        await ask();

        expect(resolvedLine().environmentLength).toBe(0);
      });

      /**
       * `redactLogContext` blanks any key merely CONTAINING `clipboard`,
       * `token`, `secret` or `selected_text`, silently and with no error — the
       * `selectionPoll` trap. Run through the REAL redactor.
       */
      it("emits an environment key that survives the real redactor", async () => {
        attachEnvironment();

        await ask();

        const context = resolvedLine();
        expect(redactLogContext(context)).toEqual(context);
        expect(context).toHaveProperty("environmentLength");
      });

      /**
       * The block names the user's own presets and states the minute they
       * pressed the hotkey, and these lines are copyable and exportable from the
       * Logs tab. Lengths only, exactly like the passage and the prefix.
       */
      it("never writes a directive line into a log", async () => {
        attachEnvironment(`${ENVIRONMENT}\n- Clinic letter polish (2026-08-11T05:28:00.000Z)`);

        await ask();

        const everythingLogged = JSON.stringify([
          ...loggerMock.debug.mock.calls,
          ...loggerMock.info.mock.calls,
          ...loggerMock.warn.mock.calls,
          ...loggerMock.error.mock.calls,
        ]);
        expect(everythingLogged).not.toContain("Clinic letter polish");
        expect(everythingLogged).not.toContain("Asia/Tokyo");
      });
    });
  });

  /**
   * Five of the six paths that decline to call a provider used to return in
   * total silence, so a user whose ghost text never appeared had nothing at all
   * to look at — not even enough to tell a disabled feature from a profile that
   * names no model. Each assertion below pins the `reason` token, because that
   * is what a bug report gets grepped for; the prose beside it is free to change.
   */
  describe("why no request was made", () => {
    /** Every context this suite's lines carry, whatever level they came out at. */
    const loggedContexts = (): LogContext[] =>
      [...loggerMock.debug.mock.calls, ...loggerMock.warn.mock.calls].map(
        (call) => call[2] as LogContext,
      );

    const reasonsLogged = (): unknown[] =>
      loggedContexts().map((context) => context.reason);

    const disableFeature = (): void => {
      getProfileSettingMock.mockImplementation((key: string) =>
        key === "settingsAutocomplete" ? { enabled: false, model: "" } : { presets: [] },
      );
    };

    const removeEveryModel = (): void => {
      getProfileSettingMock.mockImplementation((key: string) =>
        key === "settingsAutocomplete" ? { enabled: true, model: "" } : { presets: [] },
      );
      getDefaultModelIdMock.mockReturnValue("");
    };

    it("states that the feature is off", async () => {
      disableFeature();

      await ask();

      expect(loggerMock.debug).toHaveBeenCalledOnce();
      expect(loggerMock.debug.mock.calls[0]?.[2]).toMatchObject({ reason: "disabled" });
    });

    it("states that the prefix is too short, with its length and the threshold", async () => {
      await ask({ prefix: BELOW_THRESHOLD });

      expect(loggerMock.debug.mock.calls[0]?.[2]).toMatchObject({
        reason: "prefix-too-short",
        prefixLength: MIN_PREFIX_CHARS - 1,
        minPrefixChars: MIN_PREFIX_CHARS,
      });
    });

    /**
     * A `warn`, not a `debug`. Nothing on screen says the feature has turned
     * itself off, and no amount of retrying will fix a corrupt or unwritable
     * counter file — being told is the only route to a fix.
     */
    it("warns that the usage counter could not be read, and says what threw", async () => {
      usageStoreMock.getDay.mockImplementation(() => {
        throw new Error("ENOSPC: no space left on device");
      });

      await ask();

      expect(loggerMock.warn).toHaveBeenCalledOnce();
      expect(loggerMock.warn.mock.calls[0]?.[2]).toMatchObject({
        reason: "usage-unreadable",
        stage: "read",
        errorName: "Error",
      });
    });

    /** Same reasoning as above: silent, invisible, and unfixable unless stated. */
    it("warns that no model is configured, and names the settings it checked", async () => {
      removeEveryModel();

      await ask();

      expect(loggerMock.warn).toHaveBeenCalledOnce();
      expect(loggerMock.warn.mock.calls[0]?.[2]).toMatchObject({
        reason: "no-model",
        checkedSources: [
          "settingsAutocomplete.model",
          "askPreset.model",
          "profileDefaultModel",
        ],
      });
    });

    it("states a cache hit rather than looking like a request that never happened", async () => {
      await ask();
      loggerMock.debug.mockClear();

      await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
      expect(loggerMock.debug.mock.calls[0]?.[2]).toMatchObject({
        reason: "cache-hit",
        prefixLength: LONG_PREFIX.length,
        hasSuggestion: true,
      });
    });

    /**
     * The cap line predates the rest and keeps its own once-per-day throttle,
     * which is stricter than the interval below. It gains only the machine
     * -readable token the others carry.
     */
    it("tags the existing daily-cap warning with the same reason vocabulary", async () => {
      daySpendUsd = DEFAULT_DAILY_COST_CAP_USD;

      await ask();

      expect(loggerMock.warn.mock.calls[0]?.[2]).toMatchObject({
        reason: "cap-reached",
        capUsd: DEFAULT_DAILY_COST_CAP_USD,
        spentUsd: DEFAULT_DAILY_COST_CAP_USD,
      });
    });

    /**
     * The runaway stop, and it must be distinguishable from the budget in the
     * log — they mean opposite things. `cap-reached` says the user spent what
     * they chose to; `request-backstop` says a loop ran up a count no typing
     * can produce, on spend the budget could not see.
     */
    it("tags the request backstop with its own reason", async () => {
      dayRequests = DAILY_REQUEST_BACKSTOP;

      await ask();

      expect(loggerMock.warn.mock.calls[0]?.[2]).toMatchObject({
        reason: "request-backstop",
        backstop: DAILY_REQUEST_BACKSTOP,
      });
    });

    /**
     * Every one of these paths is on the typing route. A line per request would
     * fill `userData/logs/*.jsonl` with the diagnostic instead of the diagnosis,
     * and leave the Logs tab unreadable — the feature would be worse for having
     * been instrumented.
     */
    describe("throttling", () => {
      it("logs one line per reason however many requests hit it", async () => {
        disableFeature();

        for (let i = 0; i < 40; i += 1) await ask({ requestId: i });

        expect(loggerMock.debug).toHaveBeenCalledOnce();
      });

      it("reports how many it suppressed on the next line for that reason", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(new Date(2026, 6, 31, 12, 0, 0));
          disableFeature();
          for (let i = 0; i < 5; i += 1) await ask({ requestId: i });

          vi.setSystemTime(
            new Date(2026, 6, 31, 12, 0, 0).getTime() + AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS,
          );
          await ask({ requestId: 99 });
        } finally {
          vi.useRealTimers();
        }

        expect(loggerMock.debug).toHaveBeenCalledTimes(2);
        expect(loggerMock.debug.mock.calls[1]?.[2]).toMatchObject({
          reason: "disabled",
          suppressedSincePrevious: 4,
        });
      });

      /**
       * A single "last reason" slot would emit on every event once two reasons
       * alternate — which is what backspacing across `MIN_PREFIX_CHARS` does.
       * The throttle is per reason precisely so that stays bounded.
       */
      it("stays bounded when two reasons alternate", async () => {
        removeEveryModel();

        for (let i = 0; i < 20; i += 1) {
          await ask({ requestId: i, prefix: BELOW_THRESHOLD });
          await ask({ requestId: i, prefix: LONG_PREFIX });
        }

        expect(reasonsLogged().sort()).toEqual(["no-model", "prefix-too-short"]);
      });

      it("does not let one reason silence a different one", async () => {
        await ask({ prefix: BELOW_THRESHOLD });
        disableFeature();
        await ask();

        expect(reasonsLogged()).toEqual(["prefix-too-short", "disabled"]);
      });
    });

    /**
     * `redactLogContext` blanks any key merely CONTAINING `clipboard`, `token`,
     * `secret` or `selected_text`, and it does so with no error — this project
     * already lost a latency metric to exactly that (the `selectionPoll` phase
     * name). Every key these lines emit goes through the REAL redactor here
     * rather than being eyeballed.
     */
    it("emits only context keys that survive the real redactor", async () => {
      await ask({ prefix: BELOW_THRESHOLD });
      await ask();
      await ask({ requestId: 2 });
      usageStoreMock.getDay.mockImplementation(() => {
        throw new Error("ENOSPC");
      });
      await ask({ requestId: 3, prefix: `${LONG_PREFIX} other` });
      removeEveryModel();
      resetAutocompleteState();
      await ask({ requestId: 4, prefix: `${LONG_PREFIX} again` });

      const contexts = loggedContexts();
      expect(contexts.length).toBeGreaterThanOrEqual(4);
      for (const context of contexts) {
        expect(redactLogContext(context)).toEqual(context);
      }
    });

    /**
     * The whole feature is about text the user has NOT chosen to send anywhere,
     * and Logs-tab lines are copyable and exportable. Lengths and counts only —
     * on the refusal paths and on the success path alike.
     */
    it("never writes the typed text, the suffix or the suggestion into a log line", async () => {
      const prefix = "my private unsent sentence about a medical result";
      const suffix = " and its confidential continuation";
      const suggestion = " a model completion nobody asked to store";
      respondWith(suggestion);

      await ask({ prefix, suffix });
      await ask({ requestId: 2, prefix, suffix });
      await ask({ requestId: 3, prefix: BELOW_THRESHOLD });

      const everythingLogged = JSON.stringify([
        ...loggerMock.debug.mock.calls,
        ...loggerMock.info.mock.calls,
        ...loggerMock.warn.mock.calls,
        ...loggerMock.error.mock.calls,
      ]);
      for (const secret of [prefix, suffix, suggestion, "private", "confidential"]) {
        expect(everythingLogged).not.toContain(secret);
      }
    });
  });

  /**
   * THE REGRESSION THIS WHOLE CHANGE EXISTS TO PREVENT, driven end to end
   * through the service rather than only through the parser.
   *
   * The model must answer `{"suggestion":"…"}` and NOTHING that fails to parse
   * may reach the UI. That is the property, and it is what makes refusal prose
   * unable to become ghost text by construction: a sentence is not JSON,
   * whatever sentence a given model happens to choose.
   */
  describe("the JSON reply contract", () => {
    const unparseableLines = (): LogContext[] =>
      loggerMock.warn.mock.calls
        .map((call) => call[2] as LogContext)
        .filter((context) => context?.reason === "unparseable-reply");

    it("returns the suggestion carried in the envelope", async () => {
      respondRaw('{"suggestion":" over the lazy dog."}');

      expect((await ask()).suggestion).toBe(" over the lazy dog.");
    });

    /**
     * The two strings the running app actually produced: `ornith-1.0-9b` via LM
     * Studio at a 3-character prefix, each returned AS THE SUGGESTION because
     * the old prompt's closing English sentence invited a prose continuation.
     * Each painted as ghost text one Tab press from the user's own question.
     * Pinned verbatim — a paraphrase would let the observed failure drift out of
     * the suite while the test still passed.
     */
    it.each([
      'Nothing to continue here as the input text "tes" appears to be an incomplete word or fragment without clear context for further',
      "nothing at all, as there is no clear context or narrative to continue.",
    ])("shows nothing for the real refusal %#", async (refusal) => {
      respondRaw(refusal);

      expect((await ask()).suggestion).toBeNull();
    });

    it("unwraps a fenced envelope, which models add reflexively", async () => {
      respondRaw('```json\n{"suggestion":" over the lazy dog."}\n```');

      expect((await ask()).suggestion).toBe(" over the lazy dog.");
    });

    /**
     * The whole property in one line: anything that is not the shape yields NO
     * suggestion. A truncated envelope in particular must never become a partial
     * string — that string would be inserted verbatim on Tab.
     */
    it.each([
      ["an empty-string answer", '{"suggestion":""}'],
      ["a truncated envelope", '{"suggestion":" over the lazy do'],
      ["a non-string suggestion field", '{"suggestion":42}'],
      ["a null suggestion field", '{"suggestion":null}'],
      ["a bare string, which is what the old protocol expected", " over the lazy dog."],
      ["prose wrapped around a valid object", 'Sure! {"suggestion":" tail"}'],
    ])("shows nothing for %s", async (_description, raw) => {
      respondRaw(raw);

      expect((await ask()).suggestion).toBeNull();
    });

    /**
     * An empty-string answer is the model OBEYING the contract, so it must not
     * be reported as a broken one — otherwise every quiet moment produces a
     * warning and the warning stops meaning anything.
     */
    it("says nothing when the model answers with an empty suggestion", async () => {
      respondRaw('{"suggestion":""}');

      expect((await ask()).suggestion).toBeNull();
      expect(unparseableLines()).toHaveLength(0);
    });

    describe("saying so", () => {
      /**
       * `warn` on the FIRST occurrence, unlike the timing reasons beside it.
       * There is no ordinary version of this: a model either answers in the
       * contract or it does not, and one that does not fails on every request
       * for as long as it stays selected — while the UI shows the same empty
       * space it shows for a model with genuinely nothing to suggest.
       */
      it("warns the first time a reply is not the contract", async () => {
        respondRaw("I cannot continue that fragment.");

        await ask();

        expect(loggerMock.warn).toHaveBeenCalled();
        expect(unparseableLines()[0]).toMatchObject({
          reason: "unparseable-reply",
          model: "ornith-1.0-9b",
          provider: "lmstudio",
          replyLength: "I cannot continue that fragment.".length,
        });
      });

      // A broken model produces this on EVERY keystroke; an unthrottled warn
      // per keypress is the flood the throttle exists for.
      it("says it once however many replies are refused", async () => {
        respondRaw("I cannot continue that fragment.");

        for (let press = 0; press < 5; press += 1) {
          await ask({ requestId: press, prefix: `${LONG_PREFIX} ${press}` });
        }

        expect(unparseableLines()).toHaveLength(1);
      });

      it("emits only context keys that survive the real redactor", async () => {
        respondRaw("I cannot continue that fragment.");
        await ask();

        const context = unparseableLines()[0] ?? {};
        expect(redactLogContext(context)).toEqual(context);
        expect(Object.keys(context).length).toBeGreaterThan(1);
      });

      /**
       * The reply is model output ABOUT the user's unsent text, and it quotes it
       * — the real refusal above contains the typed fragment verbatim. Logs-tab
       * lines are copyable and exportable, so the length goes in and the text
       * never does.
       */
      it("carries the reply's length, never the reply, the prefix or the suffix", async () => {
        const prefix = "my private unsent sentence about a medical result";
        respondRaw(`Nothing to continue here as the input text "${prefix}" is unclear`);

        await ask({ prefix, suffix: " and its confidential continuation" });

        const everythingLogged = JSON.stringify([
          ...loggerMock.debug.mock.calls,
          ...loggerMock.info.mock.calls,
          ...loggerMock.warn.mock.calls,
          ...loggerMock.error.mock.calls,
        ]);
        for (const secret of [prefix, "private", "medical", "confidential", "Nothing to continue"]) {
          expect(everythingLogged).not.toContain(secret);
        }
      });
    });

    /**
     * The reply was dispatched and billed whether or not it parsed, so the
     * rollup must still count it — otherwise a model that emits nothing usable
     * also spends invisibly.
     */
    it("still records the spend for a reply it discarded", async () => {
      respondRaw("I cannot continue that fragment.");

      await ask();

      expect(usageStoreMock.recordDispatch).toHaveBeenCalledOnce();
      expect(usageStoreMock.recordUsage).toHaveBeenCalledOnce();
    });

    /**
     * Cached as a null, like any other empty result: a model that cannot answer
     * this prefix cannot answer it a keystroke later either, and re-billing it
     * on every backspace-and-retype is what the cache exists to stop.
     */
    it("does not re-bill an identical prefix after an unparseable reply", async () => {
      respondRaw("I cannot continue that fragment.");

      await ask();
      const second = await ask({ requestId: 2 });

      expect(makeAIRequestMock).toHaveBeenCalledOnce();
      expect(second.suggestion).toBeNull();
    });
  });

  /**
   * A request that WAS dispatched and WAS billed, and reached nobody. Distinct
   * from every refusal above, which never called a provider at all.
   *
   * This is the half of "the model is too slow" that only main can see: with a
   * 24-second model and a user who keeps typing, every request is killed by the
   * next keystroke, so nothing resolves, nothing is painted, and — until this
   * line existed — not one word was written anywhere while every one of those
   * prompts was billed. The renderer's complementary half (`reply-too-late`,
   * for a reply that did answer and landed after the caret moved) is in
   * `ipc.ts`, because only the renderer knows where the caret is.
   */
  describe("a dispatched suggestion that reached nobody", () => {
    /** Rejects with an AbortError the moment the signal fires, as a provider does. */
    const rejectOnAbort = (): void => {
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
    };

    /** Dispatches, supersedes, and lets the abort rejection settle. */
    const supersede = async (count = 1): Promise<void> => {
      rejectOnAbort();
      for (let index = 0; index < count + 1; index += 1) {
        void ask({ requestId: index, prefix: `${LONG_PREFIX} ${index}` });
        await waitForCalls(index + 1);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    const wastedLine = (): [string, string, LogContext] | undefined =>
      (loggerMock.warn.mock.calls[0] ?? loggerMock.debug.mock.calls[0]) as
        | [string, string, LogContext]
        | undefined;

    it("names the model it was slow on, rather than returning in silence", async () => {
      await supersede();

      expect(wastedLine()?.[2]).toMatchObject({
        reason: "superseded",
        model: "openai::gpt-4o-mini",
      });
      expect(wastedLine()?.[2].latencyMs).toEqual(expect.any(Number));
    });

    it("stays at debug for a single supersession, which is ordinary fast typing", async () => {
      await supersede();

      expect(loggerMock.warn).not.toHaveBeenCalled();
      expect(
        loggerMock.debug.mock.calls.filter(
          (call) => (call[2] as LogContext).reason === "superseded",
        ),
      ).toHaveLength(1);
    });

    /**
     * The line has to be throttled like every other one on the typing path: a
     * model slow enough to be superseded once is slow enough to be superseded
     * on every keystroke, which is a line per keypress into a file the user
     * later exports.
     */
    /**
     * As many as one window allows: past `RATE_LIMIT_PER_SESSION` the requests
     * are refused before dispatch, so they are never superseded either — a
     * burst of twenty at machine speed is now exactly what that guard stops.
     */
    it("logs once however many requests are superseded", async () => {
      await supersede(RATE_LIMIT_PER_SESSION - 1);

      const supersededLines = [
        ...loggerMock.debug.mock.calls,
        ...loggerMock.warn.mock.calls,
      ].filter((call) => (call[2] as LogContext).reason === "superseded");
      expect(supersededLines).toHaveLength(1);
    });

    it("emits only context keys that survive the real redactor", async () => {
      await supersede();

      const context = wastedLine()?.[2] ?? {};
      expect(redactLogContext(context)).toEqual(context);
    });

    it("carries no typed text, only the model and the elapsed time", async () => {
      const prefix = "my private unsent sentence about a medical result";
      rejectOnAbort();
      void ask({ requestId: 1, prefix });
      await waitForCalls(1);
      void ask({ requestId: 2, prefix: `${prefix} more` });
      await waitForCalls(2);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const everythingLogged = JSON.stringify([
        ...loggerMock.debug.mock.calls,
        ...loggerMock.warn.mock.calls,
      ]);
      expect(everythingLogged).not.toContain(prefix);
      expect(everythingLogged).not.toContain("private");
    });

    /**
     * The join between the two halves. The renderer reports only an id, because
     * a model name coming UP from it would be renderer-controlled text in an
     * exportable log file; these are main's own measurements, looked up by that
     * id.
     */
    describe("takeAutocompleteResolution", () => {
      it("hands back what the round trip actually was", async () => {
        respondWith(" over the lazy dog.");

        await ask({ requestId: 7 });

        expect(takeAutocompleteResolution("window-1", 7)).toMatchObject({
          requestId: 7,
          model: "gpt-4o-mini",
          provider: "openai",
        });
      });

      /** Consumed by the read, so a replayed id cannot re-emit the line. */
      it("gives the same reply up only once", async () => {
        respondWith(" over the lazy dog.");
        await ask({ requestId: 7 });

        takeAutocompleteResolution("window-1", 7);

        expect(takeAutocompleteResolution("window-1", 7)).toBeNull();
      });

      it("refuses an id it did not answer", async () => {
        respondWith(" over the lazy dog.");
        await ask({ requestId: 7 });

        expect(takeAutocompleteResolution("window-1", 8)).toBeNull();
      });

      it("refuses another surface's reply", async () => {
        respondWith(" over the lazy dog.");
        await ask({ requestId: 7 });

        expect(takeAutocompleteResolution("window-2", 7)).toBeNull();
      });

      /**
       * A cache hit calls no provider, so it has no model and no latency to
       * blame — and it is instant, so it is never the thing that was too slow.
       */
      it("records nothing for a reply served from the cache", async () => {
        respondWith(" over the lazy dog.");
        await ask({ requestId: 7 });
        takeAutocompleteResolution("window-1", 7);

        await ask({ requestId: 8 });

        expect(takeAutocompleteResolution("window-1", 8)).toBeNull();
      });

      it("records nothing for a refusal that never called a provider", async () => {
        await ask({ requestId: 7, prefix: BELOW_THRESHOLD });

        expect(takeAutocompleteResolution("window-1", 7)).toBeNull();
      });

      /**
       * Keyed by a `webContents.id` that only ever increases, so an unbounded
       * map here would be a leak nothing else in the feature would reveal.
       */
      it("keeps at most RESOLUTION_MEMORY_MAX_ENTRIES surfaces, oldest out first", async () => {
        respondWith(" over the lazy dog.");
        for (let index = 0; index <= RESOLUTION_MEMORY_MAX_ENTRIES; index += 1) {
          await ask({ requestId: index, sessionId: `window-${index}`, prefix: `${LONG_PREFIX} ${index}` });
        }

        expect(takeAutocompleteResolution("window-0", 0)).toBeNull();
        expect(
          takeAutocompleteResolution(`window-${RESOLUTION_MEMORY_MAX_ENTRIES}`, RESOLUTION_MEMORY_MAX_ENTRIES),
        ).not.toBeNull();
      });
    });
  });
});
