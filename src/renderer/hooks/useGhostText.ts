/**
 * @file useGhostText.ts
 * @description Debounced ghost-text requests for a single typing surface (the
 * Ask input window today).
 *
 * Main already does the expensive gating — min-prefix, single-flight abort,
 * de-dup cache, the daily cap — so this hook is only responsible for the two
 * things main cannot see: when the user has gone idle, and which reply is
 * still wanted by the time it lands.
 *
 * THE INVALIDATION MODEL. A suggestion is a continuation of one exact
 * surface state: a specific string, split at a specific caret offset. It is
 * therefore valid only while the surface is still in THAT state, and the
 * invalidation set is every path that leaves it — the text changing
 * (`notifyChange`), the caret moving or a selection opening
 * (`notifyCaretMove`), an IME taking over (`notifyCompositionStart`), focus
 * leaving (`notifyBlur`), the ghost being dismissed, accepted, submitted, or
 * the window being reused for a new question (`clear`), and unmount.
 *
 * The earlier definition — "every path that HIDES the ghost" — is what let
 * `notifyChange` alone stand in for caret movement, and it is wrong in a way
 * worth spelling out: an arrow key, a click, or a mouse drag hides nothing
 * and fires no `input` event, so nothing ran, yet the ghost on screen now
 * continues a prefix the caret has left. It does not look stale; it looks
 * offered, and Tab inserts it in the wrong place. Hiding is a CONSEQUENCE of
 * invalidation, never the trigger for it.
 *
 * `anchorRef` is that state made explicit — the `{ text, caret }` a request
 * was issued for. `notifyCaretMove` compares against it instead of guessing,
 * so a caret that lands back on the anchor (the keyup of an ordinary
 * keystroke, which arrives right after `notifyChange` re-armed) costs
 * nothing, and the anchor also travels out with the painted suggestion so
 * callers can draw the ghost at the caret it belongs to and refuse to accept
 * it anywhere else.
 *
 * WHICH EVENTS FIRE IS NOT A GUARANTEE, so nothing that costs the user
 * anything is allowed to depend on one. Two earlier shapes of this hook were
 * each defeated by the same class of mistake: the first assumed typing implies
 * an `input` event, the second assumed a caret move implies React's synthetic
 * `onSelect`. That second assumption is measurably false. React's
 * `SelectEventPlugin` sets an internal `mouseDown` flag on `mousedown`
 * (`react-dom-client.development.js:19662` in the installed 19.2.8) and
 * `constructSelectEvent` returns early while it is set (`:3707`), clearing it
 * only on `mouseup`/`dragend`/`contextmenu`. The early return kills the
 * `keyup`, `keydown` AND `selectionchange` legs as well, so for the whole
 * duration of a click or a drag-selection NO caret event reaches this hook at
 * all — verified against this repo's React: during a held mousedown a caret
 * moved to (3,9) plus `mousemove`, `keyup` and `selectionchange` produced zero
 * `onSelect` calls, and only the `mouseup` reported the new selection.
 *
 * `readSurface` is the answer. It reads the LIVE surface at the instant of the
 * call, so the two moments that cost the user something re-check the anchor
 * with no event involved:
 *
 *   - DISPATCH TIME, inside the debounce callback. A mousedown landing inside
 *     the 180ms window moves the caret and fires nothing, so an event-driven
 *     hook happily bills a request for a caret the user has already left.
 *   - PAINT TIME, inside the reply handler. A reply landing while the mouse is
 *     held would otherwise paint a ghost at an anchor the caret has left, and
 *     the mirror would space it by an abandoned prefix.
 *
 * `notifyPointerDown` complements those rather than carrying them: it fires at
 * the exact edge where React goes silent, so an already-painted ghost is
 * retired before the blind window opens instead of surviving visibly through a
 * whole drag with "Tab to accept" still lit. It invalidates unconditionally,
 * with no caret comparison, precisely so it cannot be wrong about WHEN during
 * a mousedown the browser repositions the caret (it does so as the default
 * action, i.e. after the handler has run — a comparison there would read the
 * old caret and conclude nothing moved). A mousedown that happens to land on
 * the existing caret therefore costs one suggestion; unlike the keyup that
 * ends every keystroke, a mousedown is not part of any typing path, so that
 * costs nothing in the common case.
 *
 * `invalidate()` is the single funnel for all of it — cancel the pending
 * debounce, bump `requestIdRef`, drop the anchor, blank the suggestion, never
 * any subset. Bumping the id only at dispatch time — its original shape —
 * made the id the hook's ONLY invalidation signal, so it could distinguish
 * two dispatched requests from each other but nothing else could invalidate
 * anything. A reply for a prefix the user had already typed past was still
 * "the newest request ever sent", so it passed the comparison and painted a
 * ghost for text that no longer existed; blur and `clear()` had the same
 * hole, which is why a dismissed ghost could reappear and cost the user a
 * second Escape. `requestIdRef` is therefore bumped by every invalidation,
 * and a dispatch merely READS it — two dispatches can never share an id
 * because only `notifyChange` arms the timer and it always invalidates first.
 *
 * Never requests while an IME is composing. `isComposing` fires true for most
 * keystrokes of a Japanese (or other CJK) conversion, so skipping this check
 * means a billed request per keypress during composition — the exact trap
 * `AskInputWindow`'s Enter handler already documents for the same two
 * signals (`isComposing` / legacy `keyCode === 229`).
 *
 * DIAGNOSTICS. Four paths here decline to dispatch — composing, prefix below
 * the threshold, the caret having left the anchor by the time the debounce
 * fires, and a missing bridge method — and all four used to be silent. That
 * silence is worse than main's was: when the renderer never dispatches, main
 * never runs, so NOTHING is logged anywhere and "autocomplete does nothing"
 * cannot be told apart from "main refused". Each now reports its reason to main
 * over the one-way `autocomplete-skip` channel, which main validates and logs.
 *
 * Throttled per reason before it is sent (`createSkipThrottle`), because these
 * are keystroke-rate paths and a line per keypress would fill the user's log
 * file with the diagnostic instead of the diagnosis. Main throttles again on
 * arrival; that second one is the real guard, since this side is exactly the
 * side under suspicion.
 *
 * `prefixLength` and counts only. This feature's whole purpose is text the user
 * has NOT chosen to send anywhere, and Logs-tab lines are copyable and
 * exportable, so no prefix, suffix or suggestion may appear in a report.
 *
 * A FIFTH reason, `reply-too-late`, is not a non-dispatch at all: the request
 * went out, the account was billed, and the answer landed after the surface had
 * moved on — so it is discarded in the resolution handler below and nothing is
 * painted. That discard is the definition of "too late", and this side is the
 * only one that can see it, main having no knowledge of the caret. It travels
 * with the reply's `requestId` and nothing else; main matches that back to its
 * own record to name the model and the latency, because a model id sent upwards
 * from here would be renderer-controlled text in an exportable log file. Main's
 * complementary half is `superseded` in `main/service.ts`, for the requests a
 * slow model never answers at all — steady typing produces only those, and a
 * type-then-pause produces only these.
 *
 * `prefix`/`suffix` cross `structuredClone` on every `invoke`, so an unbounded
 * document would be re-cloned on every debounce firing regardless of what
 * `service.ts` itself windows down to for the prompt (`PREFIX_WINDOW_CHARS` /
 * `SUFFIX_WINDOW_CHARS` in `prompt.ts`, currently 600/200). The caps below are
 * a renderer-side IPC-cost limit, not a prompt-shaping decision — kept larger
 * than main's window on purpose so a future prompt-window change does not
 * silently start starving main of context it could have used.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createSkipThrottle } from "~/features/autocomplete/shared/autocompleteDiagnostics";
import { MIN_PREFIX_CHARS } from "~/features/autocomplete/shared/autocompleteWire";
import type { AutocompleteRendererSkipReason } from "~/features/autocomplete/shared/autocompleteDiagnostics";

/**
 * Fires once typing has been idle this long.
 *
 * 300, raised from 180 when `MIN_PREFIX_CHARS` dropped 12 → 3, and the two
 * numbers have to be read together. At twelve characters the threshold was
 * doing most of the rate limiting and this value only had to avoid dispatching
 * mid-burst. At three it is very nearly the ONLY thing between a keystroke and
 * a billed request, so what it has to clear is different: a fluent typist's
 * inter-keystroke gap is roughly 150–250 ms, and 180 sits inside that band —
 * it fired mid-word, several times per question. 300 sits above it, so a
 * request goes out at a real pause (a word boundary, or the user thinking),
 * which is also where a continuation is most likely to be worth having.
 *
 * The 120 ms this adds is invisible next to the provider round trip it gates —
 * hundreds of milliseconds at best, and tens of seconds on a badly-chosen model
 * (see the late-arrival line in `main/service.ts`). Lowering it back toward 180
 * multiplies dispatches per question by roughly three or four, which is the
 * difference between `DAILY_REQUEST_CAP` being a runaway backstop and being a
 * budget an ordinary day can exhaust.
 */
export const GHOST_TEXT_DEBOUNCE_MS = 300;
/** Characters before the caret sent over IPC, tail-kept (nearest the caret). */
export const MAX_PREFIX_CHARS_SENT = 2000;
/** Characters after the caret sent over IPC, head-kept (nearest the caret). */
export const MAX_SUFFIX_CHARS_SENT = 500;

/**
 * The exact surface state a suggestion continues from. A suggestion is only
 * meaningful — drawable, acceptable — while the surface still matches it.
 */
export type GhostTextAnchor = {
  /** The full surface text the request was issued for. */
  readonly text: string;
  /** The caret offset within `text` the suggestion continues from. */
  readonly caret: number;
};

/**
 * A live reading of the typing surface, taken at the moment of the call. The
 * shape deliberately mirrors the three DOM properties it comes from
 * (`value`/`selectionStart`/`selectionEnd`) so the reader stays a
 * one-expression DOM read with nothing to get wrong.
 */
export type GhostTextSurfaceState = {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

export type UseGhostTextOptions = {
  /**
   * Reads the surface as it is RIGHT NOW, or `null` when there is no surface
   * to read. Required rather than defaulted: a caller that omitted it would
   * silently give up every event-independent check in this hook, and the
   * feature would look like it works until money is involved.
   */
  readSurface: () => GhostTextSurfaceState | null;
};

/**
 * The one predicate that decides whether a suggestion is still live. Exported
 * so the dispatch, paint and accept checks are provably the same rule rather
 * than three hand-copied comparisons that can drift apart.
 *
 * A missing surface is off-anchor, not "probably fine": with nothing to read,
 * nothing can be proved, and the safe answer for both a billed request and an
 * insertion into the user's own question is no.
 */
export const isSurfaceOnAnchor = (
  surface: GhostTextSurfaceState | null,
  anchor: GhostTextAnchor | null,
): boolean =>
  surface !== null &&
  anchor !== null &&
  surface.text === anchor.text &&
  // A selection that merely STARTS at the anchor is off it: the ghost
  // continues the anchor's prefix, but accepting would overwrite the selected
  // run with model output the user never asked to replace.
  surface.selectionStart === anchor.caret &&
  surface.selectionEnd === anchor.caret;

export type UseGhostText = {
  /** The current suggestion, or `null` when there is none to show. */
  suggestion: string | null;
  /**
   * The state `suggestion` continues from, or `null` when there is none.
   * Callers draw the ghost at `anchor.caret` and refuse to accept it once the
   * live surface has drifted off the anchor — a backstop that holds even if a
   * caret-move event never reaches `notifyCaretMove`.
   */
  anchor: GhostTextAnchor | null;
  /**
   * Call on every textarea change. `selectionStart` splits `text` into the
   * prefix/suffix the request needs; callers with no meaningful suffix (a
   * cursor pinned to the end) may pass `text.length`.
   */
  notifyChange: (text: string, selectionStart: number) => void;
  /**
   * Call whenever the caret may have moved without the text changing — arrow
   * keys, Home/End, a completed click or drag. Invalidates unless the caret is
   * still collapsed exactly on the anchor, so the no-op case (the keyup that
   * follows an ordinary keystroke) stays free.
   *
   * This is the responsive path, not the guarantee: it only ever runs when an
   * event arrives, and React reports none for the duration of a mousedown. The
   * guarantees are `readSurface`'s dispatch/paint gates and the caller's
   * accept-time check.
   */
  notifyCaretMove: (
    text: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  /**
   * A pointer press landed on the surface. Invalidates unconditionally — see
   * the header: this is the edge at which React's `SelectEventPlugin` stops
   * reporting selection changes, and the caret has not moved yet when the
   * handler runs, so there is nothing here worth comparing.
   */
  notifyPointerDown: () => void;
  /** IME composition started: cancel anything pending and go silent. */
  notifyCompositionStart: () => void;
  /** IME composition ended: typing may resume triggering requests. */
  notifyCompositionEnd: () => void;
  /** Focus left the surface: cancel anything pending and clear the ghost. */
  notifyBlur: () => void;
  /**
   * Hides the ghost and invalidates the surface — a reply already in flight
   * is dropped when it lands, and a debounce armed but not yet fired never
   * dispatches. Backs Escape-to-dismiss, Tab-accept, submit, and the reset a
   * reused (hidden, not destroyed) window performs on a fresh question.
   */
  clear: () => void;
};

/** The painted suggestion together with the state it continues from. */
type PaintedGhost = {
  readonly suggestion: string;
  readonly anchor: GhostTextAnchor;
};

export const useGhostText = ({
  readSurface,
}: UseGhostTextOptions): UseGhostText => {
  // Suggestion and anchor are one value because they are only ever true
  // together: a suggestion without the state it continues from cannot be
  // placed or checked, and an anchor without a suggestion paints nothing.
  const [ghost, setGhost] = useState<PaintedGhost | null>(null);
  const anchorRef = useRef<GhostTextAnchor | null>(null);
  // Held in a ref so the callbacks below keep stable identities: `readSurface`
  // closes over a DOM ref and is re-created every render, and listing it as a
  // dependency would re-subscribe the document-level listeners its callers
  // install on every keystroke.
  const readSurfaceRef = useRef(readSurface);
  useEffect(() => {
    readSurfaceRef.current = readSurface;
  }, [readSurface]);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const isComposingRef = useRef(false);
  // Per hook instance, not per module: two surfaces would otherwise silence
  // each other's diagnostics, and tests would leak throttle state between cases.
  const skipThrottleRef = useRef(createSkipThrottle());

  /**
   * Tells main why nothing was dispatched — see the header's DIAGNOSTICS note.
   *
   * `prefixLength`, never the prefix. Fire-and-forget, and defensive about the
   * bridge itself: this runs on the typing path and a throw here would take the
   * keystroke handler with it.
   */
  const reportSkip = useCallback(
    (
      reason: AutocompleteRendererSkipReason,
      prefixLength: number,
      /**
       * `reply-too-late` only: the reply main is being asked about, so it can
       * answer with the model and the latency from its OWN records. Nothing
       * about the provider travels upwards from here.
       */
      requestId?: number,
    ): void => {
      const decision = skipThrottleRef.current.admit(reason, Date.now());
      if (!decision.emit) return;
      window.electronAPI?.reportAutocompleteSkip?.({
        reason,
        prefixLength,
        suppressedSincePrevious: decision.suppressedSincePrevious,
        ...(requestId === undefined ? {} : { requestId }),
      });
    },
    [],
  );

  const cancelDebounce = useCallback((): void => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
  }, []);

  // The single funnel described in the header: hiding the ghost and closing
  // the door on whatever could repaint it are one operation, never two, so no
  // caller can do half of it.
  const invalidate = useCallback((): void => {
    cancelDebounce();
    requestIdRef.current += 1;
    anchorRef.current = null;
    setGhost(null);
  }, [cancelDebounce]);

  // Two names for one operation, kept distinct at the call site because the
  // reasons differ (focus left vs. the user dismissed/accepted it) even
  // though the required response is identical.
  const clear = invalidate;
  const notifyBlur = invalidate;
  const notifyPointerDown = invalidate;

  const notifyChange = useCallback(
    (text: string, selectionStart: number): void => {
      // Runs before every early return below: a prefix that has dropped under
      // MIN_PREFIX_CHARS arms no timer, so nothing later would ever clear a
      // ghost painted by a reply still in flight.
      invalidate();

      const rawPrefix = text.slice(0, selectionStart);
      if (isComposingRef.current) {
        reportSkip("composing", rawPrefix.length);
        return;
      }

      if (rawPrefix.length < MIN_PREFIX_CHARS) {
        reportSkip("prefix-too-short", rawPrefix.length);
        return;
      }

      // Armed and anchored together: below the threshold nothing is armed, so
      // there is nothing for a later caret move to protect either.
      const anchor: GhostTextAnchor = { text, caret: selectionStart };
      anchorRef.current = anchor;

      const prefix = rawPrefix.slice(-MAX_PREFIX_CHARS_SENT);
      const suffix = text.slice(selectionStart, selectionStart + MAX_SUFFIX_CHARS_SENT);

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = undefined;
        // The event-independent spend gate. Nothing above this line proves the
        // caret is still where the request would be for — a mousedown inside
        // the debounce window repositions it and fires no caret event at all
        // (see the header). Reading the live surface here needs no event, so
        // an abandoned caret cannot be billed for.
        if (!isSurfaceOnAnchor(readSurfaceRef.current(), anchor)) {
          reportSkip("caret-moved", prefix.length);
          invalidate();
          return;
        }
        const requestId = requestIdRef.current;
        // Reported rather than assumed. A missing bridge method throws right
        // here, inside a timer callback, so the failure reaches no `catch` in
        // this file and no log in main — the renderer simply goes quiet, which
        // is indistinguishable from every other silent path this file now
        // reports. The Ask window's payload arriving proves the preload loaded,
        // so the reporting method below is reachable even when this one is not.
        if (typeof window.electronAPI?.requestAutocompleteSuggestion !== "function") {
          reportSkip("bridge-unavailable", prefix.length);
          invalidate();
          return;
        }
        void window.electronAPI
          .requestAutocompleteSuggestion({ requestId, prefix, suffix })
          .then(
            (reply) => {
              // Rejects any reply the surface has moved on from, and — since
              // `invoke` resolutions can interleave — an older reply arriving
              // after a newer one too.
              //
              // This discard, and the paint gate below, ARE "the suggestion
              // arrived too late to be useful": the provider was called, the
              // account was billed, and the answer reached nobody because the
              // user moved on first. Reported rather than silently dropped,
              // because from the Logs tab a 24-second model that always misses
              // is indistinguishable from a feature that does not work — and
              // only this side can see it, main having no idea where the caret
              // is. The reply's own id goes with it so main can name the model
              // it was slow on; the renderer sends no provider detail itself.
              if (reply.requestId !== requestIdRef.current) {
                reportSkip("reply-too-late", prefix.length, reply.requestId);
                return;
              }
              if (reply.suggestion === null) {
                setGhost(null);
                return;
              }
              // The event-independent paint gate, for the same reason: a reply
              // landing mid-drag would otherwise be painted at an anchor the
              // caret has left, spaced by an abandoned prefix, with "Tab to
              // accept" lit under it.
              if (!isSurfaceOnAnchor(readSurfaceRef.current(), anchor)) {
                reportSkip("reply-too-late", prefix.length, reply.requestId);
                invalidate();
                return;
              }
              setGhost({ suggestion: reply.suggestion, anchor });
            },
            () => {
              // Ghost text is best-effort: main logs its own failures, and an
              // aborted request rejecting is the expected outcome rather than
              // a fault. Without a rejection handler each debounce firing
              // raises an unhandled rejection in the renderer while the user
              // sees exactly what they see here — no ghost.
              if (requestId !== requestIdRef.current) return;
              setGhost(null);
            },
          );
      }, GHOST_TEXT_DEBOUNCE_MS);
    },
    [invalidate, reportSkip],
  );

  const notifyCaretMove = useCallback(
    (text: string, selectionStart: number, selectionEnd: number): void => {
      const anchor = anchorRef.current;
      // Nothing anchored means nothing in flight and nothing painted, so a
      // caret move has nothing to invalidate — and must not bump the id or
      // cancel a debounce that no anchor is backing.
      if (anchor === null) return;
      // Same predicate as the dispatch, paint and accept gates — the reported
      // caret merely stands in for a live read here, because the event carries
      // the surface state with it.
      if (isSurfaceOnAnchor({ text, selectionStart, selectionEnd }, anchor)) {
        return;
      }
      invalidate();
    },
    [invalidate],
  );

  const notifyCompositionStart = useCallback((): void => {
    isComposingRef.current = true;
    invalidate();
  }, [invalidate]);

  const notifyCompositionEnd = useCallback((): void => {
    isComposingRef.current = false;
  }, []);

  // Unmount (window closed/hidden mid-debounce): the same invalidation minus
  // the setState React would warn about on an unmounted tree.
  useEffect(() => {
    return () => {
      cancelDebounce();
      requestIdRef.current += 1;
      anchorRef.current = null;
    };
  }, [cancelDebounce]);

  return {
    suggestion: ghost?.suggestion ?? null,
    anchor: ghost?.anchor ?? null,
    notifyChange,
    notifyCaretMove,
    notifyPointerDown,
    notifyCompositionStart,
    notifyCompositionEnd,
    notifyBlur,
    clear,
  };
};

export default useGhostText;
