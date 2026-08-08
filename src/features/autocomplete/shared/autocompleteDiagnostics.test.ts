import { describe, expect, it } from "vitest";
import { redactLogContext } from "~/features/logs/shared/logging";
import {
  AUTOCOMPLETE_RENDERER_SKIP_REASONS,
  AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS,
  createSkipThrottle,
  isAutocompleteRendererSkipReason,
  wastedSuggestionLogLevel,
} from "./autocompleteDiagnostics";
import type { AutocompleteWastedReason } from "./autocompleteDiagnostics";

describe("isAutocompleteRendererSkipReason", () => {
  it.each(AUTOCOMPLETE_RENDERER_SKIP_REASONS)("accepts %s", (reason) => {
    expect(isAutocompleteRendererSkipReason(reason)).toBe(true);
  });

  /**
   * The guard is what stops renderer-controlled text reaching a log file the
   * user can export, so anything not on the list is not a reason.
   */
  it.each(["", "composing ", "COMPOSING", "prefix_too_short", 1, null, undefined, {}, []])(
    "rejects %p",
    (value) => {
      expect(isAutocompleteRendererSkipReason(value)).toBe(false);
    },
  );
});

describe("createSkipThrottle", () => {
  it("admits the first occurrence of a reason immediately", () => {
    const throttle = createSkipThrottle();

    expect(throttle.admit("disabled", 0)).toEqual({
      emit: true,
      suppressedSincePrevious: 0,
    });
  });

  it("refuses the same reason again inside the interval", () => {
    const throttle = createSkipThrottle();
    throttle.admit("disabled", 0);

    expect(throttle.admit("disabled", AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS - 1)).toEqual({
      emit: false,
    });
  });

  it("admits again once the interval has elapsed, carrying what it swallowed", () => {
    const throttle = createSkipThrottle();
    throttle.admit("disabled", 0);
    throttle.admit("disabled", 1);
    throttle.admit("disabled", 2);

    expect(throttle.admit("disabled", AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS)).toEqual({
      emit: true,
      suppressedSincePrevious: 2,
    });
  });

  it("resets the swallowed count after reporting it", () => {
    const throttle = createSkipThrottle(10);
    throttle.admit("disabled", 0);
    throttle.admit("disabled", 1);
    throttle.admit("disabled", 10);

    expect(throttle.admit("disabled", 20)).toEqual({
      emit: true,
      suppressedSincePrevious: 0,
    });
  });

  it("tracks reasons independently, so one cannot silence another", () => {
    const throttle = createSkipThrottle();
    throttle.admit("disabled", 0);

    expect(throttle.admit("no-model", 1)).toMatchObject({ emit: true });
  });

  /**
   * The alternation case, and the reason this is an interval throttle rather
   * than an "emit whenever the reason changed" one. Backspacing across
   * `MIN_PREFIX_CHARS` alternates two reasons, and a change-detecting throttle
   * would emit on every single event — the flood again, wearing a transition's
   * clothes.
   */
  it("stays bounded while two reasons alternate", () => {
    const throttle = createSkipThrottle();
    let emitted = 0;
    for (let tick = 0; tick < 100; tick += 1) {
      const reason = tick % 2 === 0 ? "prefix-too-short" : "cache-hit";
      if (throttle.admit(reason, tick).emit) emitted += 1;
    }

    expect(emitted).toBe(2);
  });

  it("forgets everything on reset, so nothing leaks between tests", () => {
    const throttle = createSkipThrottle();
    throttle.admit("disabled", 0);
    throttle.reset();

    expect(throttle.admit("disabled", 1)).toEqual({
      emit: true,
      suppressedSincePrevious: 0,
    });
  });
});

/**
 * `redactLogContext` blanks any key merely CONTAINING `clipboard`, `token`,
 * `secret` or `selected_text`, silently and with no error — this project has
 * already lost a latency metric to exactly that trap. Every reason token is
 * checked here as a value too, since values are run through
 * `redactLogMessage`.
 */
describe("reason tokens survive the real redactor", () => {
  it.each(AUTOCOMPLETE_RENDERER_SKIP_REASONS)("keeps %s intact", (reason) => {
    const context = { reason, prefixLength: 12, suppressedSincePrevious: 3 };

    expect(redactLogContext(context)).toEqual(context);
  });

  const WASTED_REASONS: AutocompleteWastedReason[] = [
    "superseded",
    "reply-too-late",
    "unparseable-reply",
  ];

  /**
   * The wasted-suggestion lines carry the only two fields that make them worth
   * emitting — which model, and how long it took — so a silently blanked key
   * here would leave a line that says a suggestion was wasted and refuses to
   * say by what.
   */
  it.each(WASTED_REASONS)("keeps %s and its model/latency fields intact", (reason) => {
    const context = {
      reason,
      model: "lmstudio::ornith-1.0-35b",
      provider: "lmstudio",
      latencyMs: 24484,
      prefixLength: 39,
      /**
       * `unparseable-reply` only, and the key that has to be watched: the
       * obvious names for it are all trapped. `replyTokens` would be blanked for
       * containing `token`, exactly as `clipboardRead` was, leaving a warning
       * that says the model emitted garbage and refuses to say how much.
       */
      replyLength: 128,
      suppressedSincePrevious: 3,
      suppressedInRenderer: 2,
      suppressedInMain: 1,
    };

    expect(redactLogContext(context)).toEqual(context);
  });
});

/**
 * A single late suggestion while typing fast is ordinary; every suggestion late
 * is a model that cannot serve this feature, invisible from the UI and
 * unfixable unless the user is told. The throttle's suppressed count already
 * separates the two, so no extra counter and no new threshold is invented.
 */
describe("wastedSuggestionLogLevel", () => {
  it("keeps a one-off at debug", () => {
    expect(wastedSuggestionLogLevel(0)).toBe("debug");
  });

  it.each([1, 2, 50])("raises a recurrence to warn: %p suppressed", (suppressed) => {
    expect(wastedSuggestionLogLevel(suppressed)).toBe("warn");
  });
});
