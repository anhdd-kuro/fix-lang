/**
 * @file clipboardObserver.ts
 * @description Pure, electron-free core of the stale-clipboard guard.
 * Answers "how old is the clipboard content" without ever holding the
 * content itself: an observation is folded down to a SHA-256 hash, a length,
 * and (when it represents a genuine change) a timestamp. Nothing here can
 * leak the clipboard text because nothing here stores it.
 *
 * Length alone would not do — two different secrets of the same length must
 * both register as a change, which is exactly why `hash` exists instead of
 * comparing `text.length`.
 *
 * Clock is injected (`now = Date.now`), the same shape as
 * `startLatencyTimer({ now })` in `src/main/logging/latencyTimer.ts`, so
 * every duration in this module's tests is asserted exactly rather than
 * tolerance-matched — no fake timers needed here at all, only explicit `at`
 * arguments.
 */
import { createHash } from "node:crypto";

export type ClipboardObserverSnapshot = {
  length: number;
  hasBaseline: boolean;
  lastChangedAt: number | null;
};

export type ClipboardObserver = {
  /** Folds one observation into the running state. No-op while suspended. */
  observe: (text: string, at?: number) => void;
  /**
   * Milliseconds since the last observed change, or — before any change has
   * been seen — since the first sighting.
   *
   * `null` only while nothing has been observed at all, which is the one
   * state where the age is genuinely unknown and the guard fails open.
   *
   * The first sighting is NOT a change, so it does not set `lastChangedAt`.
   * It does establish a LOWER BOUND: text already on the pasteboard when we
   * first looked was copied at some point before that, so it is at least this
   * old. Reporting `null` forever in that case left the stale-clipboard guard
   * permanently disarmed for the exact value it exists to catch — a password
   * copied before FixLang started, never touched again, served to a transform
   * by the empty-selection fallback.
   */
  ageMs: (at?: number) => number | null;
  /** Marks the start of a window where external code owns the clipboard. */
  suspend: () => void;
  /**
   * Ends a suspended window with the text that was written back. If it
   * hashes to the pre-suspend baseline (the normal case: we restored
   * exactly what was there), re-baselines WITHOUT moving `lastChangedAt`.
   * If it differs, something else wrote during the window, so it is folded
   * in as a real change.
   *
   * Suspend/resume nests: while an outer window is still open, an inner
   * resume only decrements the depth and folds nothing — the decision of
   * whether the clipboard genuinely changed belongs solely to the resume
   * that closes the outermost window.
   */
  resume: (restoredText: string, at?: number) => void;
  /** `{ length, hasBaseline, lastChangedAt }` — never the text, never the hash. */
  snapshot: () => ClipboardObserverSnapshot;
};

const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");

export const createClipboardObserver = ({
  now = Date.now,
}: { now?: () => number } = {}): ClipboardObserver => {
  let hash: string | null = null;
  let length = 0;
  let lastChangedAt: number | null = null;
  let baselineAt: number | null = null;
  let hasBaseline = false;
  let suspendDepth = 0;

  const fold = (text: string, at: number): void => {
    const nextHash = hashOf(text);
    const nextLength = text.length;

    if (!hasBaseline) {
      hash = nextHash;
      length = nextLength;
      baselineAt = at;
      hasBaseline = true;
      return;
    }

    if (nextHash === hash) return;

    hash = nextHash;
    length = nextLength;
    lastChangedAt = at;
  };

  return {
    observe: (text, at = now()) => {
      if (suspendDepth > 0) return;
      fold(text, at);
    },
    // A real change always wins over the baseline; the baseline is only the
    // floor for a clipboard we have never seen change.
    ageMs: (at = now()) => {
      const since = lastChangedAt ?? baselineAt;
      return since === null ? null : at - since;
    },
    suspend: () => {
      suspendDepth += 1;
    },
    resume: (restoredText, at = now()) => {
      suspendDepth = Math.max(0, suspendDepth - 1);
      // A nested resume (outer suspend still open) must not decide the
      // change/no-change question on the outer window's behalf — only the
      // resume that actually closes the last open window may fold.
      if (suspendDepth > 0) return;
      fold(restoredText, at);
    },
    snapshot: () => ({ length, hasBaseline, lastChangedAt }),
  };
};
