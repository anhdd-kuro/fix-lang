/**
 * @file autocompleteDiagnostics.ts
 * @description Why a ghost-text suggestion did not happen, and the throttle
 * that keeps saying so from becoming the next problem.
 *
 * Electron-free — imported by main, preload AND the renderer, same constraint
 * as `autocompleteWire.ts`.
 *
 * THE PROBLEM THIS EXISTS FOR. Autocomplete has two independent halves that can
 * each decline silently: the renderer may never dispatch (composing, prefix too
 * short, caret moved during the debounce), and main may refuse what it receives
 * (disabled, no model, unreadable counter, cap, cache). A user reporting "it
 * does nothing" could not tell those apart, because neither half said anything —
 * and a renderer that never dispatches leaves main with nothing to log either.
 *
 * WHY A THROTTLE IS PART OF THE CONTRACT, not an optimisation bolted on after.
 * Every one of these paths is on the typing route. Unthrottled, a single stuck
 * condition writes a line per keystroke into `userData/logs/*.jsonl`, which is
 * both a disk problem and a Logs tab nobody can read — the diagnostic would
 * destroy the thing it was added to diagnose.
 *
 * The rule is ONE LINE PER REASON PER INTERVAL, with the count of what was
 * suppressed riding on the next line so nothing is silently lost. First
 * occurrence of a reason always emits, so a transition into a new state is
 * immediate; a state that persists costs one line a minute. Deliberately NOT
 * "emit whenever the reason differs from the previous one": two reasons
 * alternating across a threshold (backspacing over `MIN_PREFIX_CHARS`) would
 * then emit on every single event, which is the flood again wearing a
 * transition's clothes.
 *
 * PRIVACY IS THE HARD CONSTRAINT HERE. This feature sends text the user has not
 * chosen to send anywhere yet, and log lines are copyable and exportable from
 * the Logs tab. Nothing in this module carries typed content: reasons are a
 * closed set of literals and the only payload is a LENGTH. Note also that
 * `redactLogContext` blanks any context key merely CONTAINING `clipboard`,
 * `token`, `secret` or `selected_text` — a well-meant key name like
 * `selected_text_length` persists as `"[REDACTED]"` with no error at all, so
 * every key emitted from here is covered by a test that runs it through the
 * real redactor.
 */

/**
 * One-way renderer → main channel. `send`, never `invoke`: this is diagnostic
 * bookkeeping on the typing path, so it must not add a round trip per event,
 * and there is no answer worth waiting for.
 */
export const AUTOCOMPLETE_SKIP_CHANNEL = "autocomplete-skip";

/**
 * Why the renderer did not dispatch. A CLOSED set, and validated against this
 * list in main: the payload is renderer input crossing a trust boundary, and an
 * arbitrary string forwarded into a log line is renderer-controlled text
 * landing in an exportable file.
 */
export const AUTOCOMPLETE_RENDERER_SKIP_REASONS = [
  /** An IME is mid-conversion; every keypress would otherwise bill a request. */
  "composing",
  /** Fewer than `MIN_PREFIX_CHARS` before the caret. */
  "prefix-too-short",
  /** The debounce fired but the caret had left the state it was armed for. */
  "caret-moved",
  /** The preload bridge is missing the suggest method — nothing can dispatch. */
  "bridge-unavailable",
  /**
   * A secure field (password input), refused by the surface before reading it —
   * reported here rather than in `service.ts` because main never receives the
   * text at all, which is the point.
   */
  "secure-field",
  /**
   * A suggestion came back, and the surface had already moved on — so it was
   * discarded unseen. The odd one out in this list: a request WAS dispatched
   * and WAS billed, and the failure is that the model took longer than the user
   * stayed still. Only the renderer can see it (main knows nothing of the
   * caret), and main is the only side that can name the model that was slow, so
   * this reason is the join between the two.
   */
  "reply-too-late",
] as const;

export type AutocompleteRendererSkipReason =
  (typeof AUTOCOMPLETE_RENDERER_SKIP_REASONS)[number];

/**
 * What the renderer reports. Lengths and counts only — never the prefix, the
 * suffix, or the suggestion.
 */
export type AutocompleteSkipReport = {
  reason: AutocompleteRendererSkipReason;
  /** Characters before the caret. The LENGTH, never the text. */
  prefixLength: number;
  /** Occurrences of this reason the renderer's own throttle swallowed. */
  suppressedSincePrevious: number;
  /**
   * `reply-too-late` only: which reply was discarded.
   *
   * A number, not a description — it is what main matches against its own
   * record of the request it just answered, so the log line can name the model
   * and the latency from MAIN's measurements. The renderer deliberately sends
   * neither: a model id supplied by the renderer would be renderer-controlled
   * text landing in an exportable log file, which is the exact thing the closed
   * reason set above exists to prevent.
   */
  requestId?: number;
};

const RENDERER_SKIP_REASONS = new Set<string>(AUTOCOMPLETE_RENDERER_SKIP_REASONS);

export const isAutocompleteRendererSkipReason = (
  value: unknown,
): value is AutocompleteRendererSkipReason =>
  typeof value === "string" && RENDERER_SKIP_REASONS.has(value);

/**
 * How long one reason stays quiet after it has been reported. A minute is long
 * enough that a stuck condition costs a handful of lines across a whole typing
 * session, short enough that a user reproducing the fault sees it on the first
 * try rather than having to remember what they did an hour ago.
 */
export const AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS = 60_000;

/**
 * A provider call that HAPPENED and reached nobody.
 *
 * Deliberately a separate vocabulary from the skip reasons above and from
 * `AutocompleteSkipReason` in `main/service.ts`, both of which mean "no request
 * was made". These two were dispatched, billed, and wasted — which is a
 * different thing to tell the user, and the only evidence that a model is too
 * slow to be usable for autocomplete at all:
 *
 * - `superseded` — killed mid-flight by a newer keystroke. It never answered.
 *   Visible ONLY in main (the renderer sees an indistinguishable rejection and
 *   cannot name the model), where the model ref and the elapsed time are both
 *   in scope.
 * - `reply-too-late` — it DID answer, and the surface had moved on, so nothing
 *   was painted. Visible ONLY in the renderer, which is the sole authority on
 *   the caret; main matches the reported `requestId` back to its own record to
 *   supply the model and the latency.
 *
 * - `unparseable-reply` — it answered IN TIME and the answer was not the JSON
 *   contract (`{"suggestion":"…"}`), so `parseReply.ts` refused it and nothing
 *   was painted. The odd one out again: the first two are timing, this one is
 *   the model itself. It is the ONLY evidence of a model that cannot serve this
 *   feature at all — the UI shows the same empty space it shows for a model with
 *   genuinely nothing to suggest, so without this line "my model emits garbage"
 *   is indistinguishable from "autocomplete is quiet today".
 *
 * No one of these subsumes another, which is why all three exist. A user typing
 * steadily against a 24-second model produces nothing but the first; a user who
 * types and then pauses produces nothing but the second; a user on a model that
 * answers in prose produces nothing but the third, on every single request.
 */
export type AutocompleteWastedReason = "superseded" | "reply-too-late" | "unparseable-reply";

/**
 * How loudly to say a suggestion was wasted.
 *
 * One late suggestion during fast typing is normal and costs the user nothing
 * they would notice — `debug`. EVERY suggestion arriving too late is a
 * misconfigured model, invisible from the UI (which just shows no ghost) and
 * unfixable without being told — `warn`.
 *
 * The distinguisher is free, because the throttle already computes it: a
 * suppressed count above zero means this same reason recurred inside the
 * interval, i.e. it is not a one-off. Nothing else has to be counted, and no
 * new threshold has to be invented and then argued about.
 */
export const wastedSuggestionLogLevel = (
  suppressedSincePrevious: number,
): "debug" | "warn" => (suppressedSincePrevious > 0 ? "warn" : "debug");

/** Emit this line, and how many of its kind were swallowed since the last one. */
export type SkipThrottleDecision =
  | { emit: true; suppressedSincePrevious: number }
  | { emit: false };

export type SkipThrottle = {
  /**
   * Decides whether this occurrence becomes a log line. Takes the clock as an
   * argument rather than reading it, so callers that already hold the request's
   * single timestamp cannot introduce a second one.
   */
  admit: (reason: string, nowMs: number) => SkipThrottleDecision;
  /** Test seam — module-level throttles would otherwise leak between tests. */
  reset: () => void;
};

/**
 * Per-reason interval throttle. Bounded by construction: with N reasons the
 * worst case is N lines per interval, whatever the user types.
 */
export const createSkipThrottle = (
  intervalMs: number = AUTOCOMPLETE_SKIP_LOG_INTERVAL_MS,
): SkipThrottle => {
  const emitted = new Map<string, { loggedAt: number; suppressed: number }>();
  return {
    admit: (reason, nowMs) => {
      const previous = emitted.get(reason);
      if (previous && nowMs - previous.loggedAt < intervalMs) {
        previous.suppressed += 1;
        return { emit: false };
      }
      emitted.set(reason, { loggedAt: nowMs, suppressed: 0 });
      return { emit: true, suppressedSincePrevious: previous?.suppressed ?? 0 };
    },
    reset: () => emitted.clear(),
  };
};
