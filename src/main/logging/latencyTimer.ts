/**
 * @file latencyTimer.ts
 * @description End-to-end latency instrumentation for the hotkey paths:
 * measures wall clock from the moment a global shortcut fires to the moment
 * the result is actually in front of the user — paste keystroke returned, or
 * result popup shown.
 *
 * The existing `clipboard.copy` / `clipboard.paste` debug lines already time
 * individual osascript round trips, but nothing states the number the user
 * actually feels: the sum, AI request included. One summary line per press
 * closes that, so a regression shows up as a single phase growing instead of
 * as a vague "feels slower".
 *
 * Two contracts worth keeping:
 *
 * - **Every timer terminates.** `finish` is called on the abort and error
 *   paths too, carrying an `outcome`, so a press that never delivered is still
 *   in the log rather than silently absent. A path that returns without
 *   finishing is a hole in the data, not a saved log line.
 * - **First `finish` wins.** The delivery path finishes inside `try`, and the
 *   `catch` finishes too; work that throws *after* delivery (history write,
 *   IPC send) must not overwrite a real `delivered` measurement with
 *   `failed`. That failure is already logged separately by the caller's own
 *   `logger.error`.
 *
 * Electron-free and clock-injectable on purpose — `now` is a parameter so the
 * durations can be asserted exactly in tests instead of tolerance-matched.
 */
import { logger } from "./logService";
import type { LogContext } from "~/features/logs/shared/logging";

export type LatencyOutcome =
  /** Result reached the user: paste keystroke returned, or popup shown. */
  | "delivered"
  /** Aborted before any request: nothing selected and clipboard empty. */
  | "no-selection"
  /** Ask AI only: the input window is up, the user now owns the clock. */
  | "input-shown"
  | "failed";

/**
 * The closed set of phase names, and the reason it is closed: `redactLogContext`
 * blanks any context KEY whose name merely contains `clipboard`, `token`,
 * `secret`, `selected_text`, … — it cannot tell a metric apart from key
 * material. A phase called `clipboardRead` therefore persists as
 * `"[REDACTED]"`, silently destroying the number it was added to expose, with
 * no error anywhere. Hence `selectionPoll` rather than `clipboardRead`.
 *
 * Every name here is asserted redaction-safe against the real redactor in
 * `latencyTimer.test.ts`, and `mark` accepts nothing else, so a new phase
 * cannot be introduced without passing that check.
 */
export const LATENCY_PHASE_NAMES = [
  /** osascript combined frontmost-app read + Cmd-C returned. */
  "keystrokeSent",
  /** Clipboard-change poll settled after the copy keystroke. */
  "selectionPoll",
  /** Ask AI's optional-context read (single step, no spinner split). */
  "selectionRead",
  /**
   * Ask AI's press-environment read (`resolveAskEnvironment`) — the `defaults`
   * spawn and the bounded history read. Dispatched CONCURRENTLY with
   * `selectionRead`, so this is the time still left on it once the context read
   * returned, not its full cost: normally ~0, and non-zero only when the
   * environment read is the slower of the two.
   *
   * Named for what it reads and nothing else. `keyboardRead` would have been
   * fine too, but anything carrying `clipboard`/`token`/`secret`/`selected_text`
   * would have been blanked by `redactLogContext` — see the note above.
   */
  "environmentRead",
  "aiRequest",
  /** Paste keystroke returned, or the result popup was shown. */
  "delivery",
] as const;

export type LatencyPhase = (typeof LATENCY_PHASE_NAMES)[number];

export type LatencyTimer = {
  /**
   * Records the time since the previous mark (or the start) under `phase`.
   * Phases are deltas, not cumulative timestamps, so they read as "where the
   * time went" and sum to roughly `totalMs`.
   */
  mark: (phase: LatencyPhase) => void;
  finish: (result: { outcome: LatencyOutcome } & LogContext) => void;
};

export const startLatencyTimer = ({
  scope,
  message,
  context = {},
  now = Date.now,
}: {
  scope: string;
  message: string;
  context?: LogContext;
  now?: () => number;
}): LatencyTimer => {
  const startedAt = now();
  const phases: Partial<Record<LatencyPhase, number>> = {};
  let lastMarkAt = startedAt;
  let finished = false;

  return {
    mark: (phase: LatencyPhase) => {
      const at = now();
      phases[phase] = at - lastMarkAt;
      lastMarkAt = at;
    },
    finish: ({ outcome, ...rest }) => {
      if (finished) {
        return;
      }
      finished = true;
      logger.info(scope, message, {
        ...context,
        ...rest,
        outcome,
        phases,
        totalMs: now() - startedAt,
      });
    },
  };
};
