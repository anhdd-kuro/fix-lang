/**
 * @file request.test.ts
 * @description The two ways the local-inference path used to lie.
 *
 * It reported `promptTokens: 0` for every response — a fabricated measurement,
 * not a gap — and it dispatched a call whose abort signal had already fired.
 * Both went unnoticed because this module had no tests at all: it was moved
 * verbatim out of `ai.request/shared.ts` and its coverage never followed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeLocalAIRequest } from "./request";

const { chatMock, abortMock, createOllamaClientMock, getLocalModelsMock, notifyRequestErrorMock } =
  vi.hoisted(() => ({
    chatMock: vi.fn(),
    abortMock: vi.fn(),
    createOllamaClientMock: vi.fn(),
    getLocalModelsMock: vi.fn(),
    notifyRequestErrorMock: vi.fn(),
  }));

vi.mock("./client", () => ({ createOllamaClient: createOllamaClientMock }));
vi.mock("~/main/llm/models/discover", () => ({ getLocalModels: getLocalModelsMock }));
// Pulls in Electron otherwise.
vi.mock("~/main/notifications/error", () => ({ notifyRequestError: notifyRequestErrorMock }));
vi.mock("~/features/providers/store/apiStore", () => ({
  getProviderEndpoint: () => ({ host: "127.0.0.1", port: 11434 }),
}));

const MODEL = "llama3.2:3b";

/** What the daemon actually returns, minus the fields this module ignores. */
const chatResponse = (overrides: Record<string, unknown> = {}) => ({
  message: { content: " over the lazy dog." },
  total_duration: 1_000,
  prompt_eval_count: 42,
  eval_count: 7,
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) =>
  makeLocalAIRequest({
    systemPrompt: "You continue text.",
    userPrompt: "The quick brown fox jumps",
    model: MODEL,
    quiet: true,
    ...overrides,
  });

describe("makeLocalAIRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // This module logs its own progress to the console; the assertions below are
    // about return values, and the noise buries a real failure.
    vi.spyOn(console, "log").mockImplementation(() => {
      // Swallowed.
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      // Swallowed.
    });
    getLocalModelsMock.mockResolvedValue([{ id: MODEL }]);
    chatMock.mockResolvedValue(chatResponse());
    createOllamaClientMock.mockReturnValue({ chat: chatMock, abort: abortMock });
  });

  /**
   * THE ROUTE: a token count reported as `0` when the truth is "unknown".
   *
   * Named after the route rather than the symptom, because the fabricated zero
   * has reached the dashboard by several different paths in this feature's life
   * and each fix that closed only the reported path let the next one in. The
   * route is the VALUE, and every consumer downstream reads it the same way:
   * `recordUsage` (`~/features/autocomplete/store/autocompleteUsageStore`) and
   * `resolveResponseCostUsd` (`~/features/autocomplete/main/service`) both decide
   * "the provider did not tell us" with `=== null`, so a `0` is booked as a
   * MEASUREMENT — `tokenlessResponses` stayed at 0 and the day reported a
   * measured zero-token total over responses whose tokens nobody knew.
   */
  describe("token counts", () => {
    it("reports the counts the daemon actually sent", async () => {
      const response = await request();

      expect(response.promptTokens).toBe(42);
      expect(response.completionTokens).toBe(7);
    });

    it.each([
      ["omits them", {}],
      ["sends a non-number", { prompt_eval_count: "42", eval_count: null }],
      ["sends NaN", { prompt_eval_count: Number.NaN, eval_count: Number.NaN }],
    ])("reports null, never 0, when the daemon %s", async (_case, overrides) => {
      chatMock.mockResolvedValue({
        message: { content: " over the lazy dog." },
        total_duration: 1_000,
        ...overrides,
      });

      const response = await request();

      expect(response.promptTokens).toBeNull();
      expect(response.completionTokens).toBeNull();
      // Spelled out: `0` is the value that made this unmeasured response read as
      // a measured zero all the way to the Analytics card.
      expect(response.promptTokens).not.toBe(0);
      expect(response.completionTokens).not.toBe(0);
    });

    /**
     * The predicate every consumer uses, applied to what this module returns.
     * Asserting the value alone would not say why `null` is the only answer that
     * survives the trip.
     */
    it("returns a shape the rollup counts as unmeasured", async () => {
      chatMock.mockResolvedValue({
        message: { content: " over the lazy dog." },
        total_duration: 1_000,
      });

      const response = await request();

      const tokensMissing =
        response.promptTokens === null || response.completionTokens === null;
      expect(tokensMissing).toBe(true);
    });

    // A prompt served entirely from Ollama's cache genuinely evaluates zero
    // prompt tokens. That zero IS the measurement and must not become N/A.
    it("keeps a genuinely reported zero as zero", async () => {
      chatMock.mockResolvedValue(chatResponse({ prompt_eval_count: 0, eval_count: 12 }));

      const response = await request();

      expect(response.promptTokens).toBe(0);
      expect(response.completionTokens).toBe(12);
    });
  });

  /**
   * The fabricated zero has to stay dead at EVERY provider, not just the one it
   * was reported on. Asserted as source text because the alternative is booting
   * five SDKs; `sumTokenField` and `usageCounts` are the sanctioned way to reach
   * these fields and both already return `null` for a gap.
   *
   * Scoped to `request.ts` deliberately: `openrouter/parsers.ts` has a
   * `promptTokens: 0` that is an accumulator seed in the Usage-tab billing
   * parser, not an AI-response field.
   */
  describe("no provider fabricates a zero token count", () => {
    it("has no request module assigning a literal 0 to either token field", async () => {
      const { readdir, readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      const providersDir = join(process.cwd(), "src/main/llm/providers");
      const entries = await readdir(providersDir, { withFileTypes: true });
      const offenders: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const file = join(providersDir, entry.name, "request.ts");
        const source = await readFile(file, "utf8").catch(() => "");
        if (/\b(?:promptTokens|completionTokens)\s*:\s*0\b/.test(source)) {
          offenders.push(`${entry.name}/request.ts`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  /**
   * THE ROUTE: `addEventListener` does not replay an event that has already
   * dispatched, so a signal that fired before the listener was attached left the
   * client uncancelled and `.chat()` ran anyway.
   *
   * The window is not theoretical. `makeAIRequest` reaches this module through a
   * lazy `import()`, and a superseded autocomplete keystroke or a profile switch
   * aborts during exactly that resolution — so the machine ran one more stale
   * inference for text the user had already moved past.
   */
  describe("a signal that aborted before dispatch", () => {
    const alreadyAborted = (): AbortSignal => {
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    };

    it("never calls the client", async () => {
      await expect(request({ abortSignal: alreadyAborted() })).rejects.toThrow();

      expect(chatMock).not.toHaveBeenCalled();
    });

    /**
     * Indistinguishable from an abort DURING the call, so no caller can branch on
     * the difference: `isAbortError` (`~/main/notifications/error`) is what keeps
     * both silent, and it matches on the name.
     */
    it("rejects with an abort-shaped error", async () => {
      await expect(request({ abortSignal: alreadyAborted() })).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    // Still registers the listener, so an abort that arrives mid-call cancels the
    // client. The pre-dispatch check is an addition, not a replacement.
    it("still cancels a call the signal aborts mid-flight", async () => {
      const controller = new AbortController();
      chatMock.mockImplementation(
        () =>
          new Promise(() => {
            // Never settles: the call has to still be open when the abort lands.
          }),
      );

      void request({ abortSignal: controller.signal });
      await vi.waitFor(() => expect(chatMock).toHaveBeenCalled());
      controller.abort();

      expect(abortMock).toHaveBeenCalled();
    });
  });
});
