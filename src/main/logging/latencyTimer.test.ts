/**
 * @file latencyTimer.test.ts
 * @description Tests for the hotkey latency timer. The clock is injected
 * rather than faked globally, so every duration below is asserted exactly —
 * a tolerance-matched assertion would pass even if phase deltas were being
 * computed against the wrong baseline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redactLogContext } from "~/features/logs/shared/logging";
import {
  LATENCY_PHASE_NAMES,
  startLatencyTimer,
  type LatencyOutcome,
} from "./latencyTimer";

const { infoMock } = vi.hoisted(() => ({ infoMock: vi.fn() }));

vi.mock("./logService", () => ({
  logger: { debug: vi.fn(), info: infoMock, warn: vi.fn(), error: vi.fn() },
}));

/** A clock that advances only when the test says so. */
const stepClock = (steps: readonly number[]) => {
  const queue = [...steps];
  let current = queue.shift() ?? 0;
  return () => {
    const value = current;
    const next = queue.shift();
    if (next !== undefined) {
      current = next;
    }
    return value;
  };
};

describe("startLatencyTimer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("survives log redaction — a phase name must not read as key material", () => {
    // `redactLogContext` blanks any KEY containing `clipboard`, `token`,
    // `secret`, `selected_text`, … by substring; it cannot tell a duration
    // apart from a copied selection. `clipboardRead` was exactly that mistake:
    // it persisted as "[REDACTED]", destroying the metric with no error. The
    // REAL redactor runs here on purpose — the mocked logger above skips it.
    const phases = Object.fromEntries(LATENCY_PHASE_NAMES.map((phase) => [phase, 1]));
    expect(redactLogContext({ phases })).toEqual({ phases });
  });

  it("reports each phase as the delta since the previous mark, plus the total", () => {
    // start=1000, keystrokeSent=1050, selectionPoll=1200, aiRequest=2400,
    // delivery=2500, finish=2500
    const timer = startLatencyTimer({
      scope: "correction.latency",
      message: "Transform latency",
      context: { presetId: "correction" },
      now: stepClock([1000, 1050, 1200, 2400, 2500, 2500]),
    });

    timer.mark("keystrokeSent");
    timer.mark("selectionPoll");
    timer.mark("aiRequest");
    timer.mark("delivery");
    timer.finish({ outcome: "delivered", delivery: "pasted" });

    expect(infoMock).toHaveBeenCalledTimes(1);
    const [scope, message, context] = infoMock.mock.calls[0];
    expect(scope).toBe("correction.latency");
    expect(message).toBe("Transform latency");
    expect(context).toEqual({
      presetId: "correction",
      delivery: "pasted",
      outcome: "delivered",
      phases: {
        keystrokeSent: 50,
        selectionPoll: 150,
        aiRequest: 1200,
        delivery: 100,
      },
      pausedMs: 0,
      totalMs: 1500,
    });
  });

  it("logs an outcome-only line when nothing was marked", () => {
    const timer = startLatencyTimer({
      scope: "correction.latency",
      message: "Transform latency",
      now: stepClock([500, 700]),
    });

    timer.finish({ outcome: "no-selection" });

    const [, , context] = infoMock.mock.calls[0];
    expect(context).toEqual({
      outcome: "no-selection",
      phases: {},
      pausedMs: 0,
      totalMs: 200,
    });
  });

  it("ignores a second finish so a post-delivery throw cannot relabel the measurement", () => {
    // Both `correction.ts` and `askFlow.ts` finish inside `try` on delivery and
    // again in `catch`; work that throws AFTER delivery (history write, IPC)
    // must not overwrite a real `delivered` with `failed`.
    const timer = startLatencyTimer({
      scope: "correction.latency",
      message: "Transform latency",
      now: stepClock([0, 100, 900]),
    });

    timer.finish({ outcome: "delivered", delivery: "popup" });
    timer.finish({ outcome: "failed" });

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock.mock.calls[0][2]).toMatchObject({ outcome: "delivered", totalMs: 100 });
  });

  it("keeps phases separate per timer — concurrent presses must not share state", () => {
    const first = startLatencyTimer({
      scope: "correction.latency",
      message: "Transform latency",
      now: stepClock([0, 10, 10]),
    });
    const second = startLatencyTimer({
      scope: "correction.latency",
      message: "Ask latency",
      now: stepClock([0, 999, 999]),
    });

    first.mark("aiRequest");
    second.mark("aiRequest");
    first.finish({ outcome: "delivered" });
    second.finish({ outcome: "delivered" });

    expect(infoMock.mock.calls[0][2]).toMatchObject({ phases: { aiRequest: 10 } });
    expect(infoMock.mock.calls[1][2]).toMatchObject({ phases: { aiRequest: 999 } });
  });

  it("defaults to Date.now when no clock is injected", () => {
    const timer = startLatencyTimer({ scope: "s", message: "m" });
    timer.mark("aiRequest");
    timer.finish({ outcome: "delivered" });

    const [, , context] = infoMock.mock.calls[0];
    expect(typeof context.totalMs).toBe("number");
    expect(context.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("excludes a pause/resume dialog wait from totalMs and the next phase delta", () => {
    // start=0, aiRequest mark=1000 (delta 1000), pause=1000, resume=5000
    // (4000ms dialog wait), delivery mark=5100 (delta 100, NOT 4100), finish=5200
    const timer = startLatencyTimer({
      scope: "correction.latency",
      message: "Transform latency",
      now: stepClock([0, 1000, 1000, 5000, 5100, 5200]),
    });

    timer.mark("aiRequest");
    timer.pause();
    timer.resume();
    timer.mark("delivery");
    timer.finish({ outcome: "delivered" });

    const [, , context] = infoMock.mock.calls[0];
    expect(context).toEqual({
      outcome: "delivered",
      phases: { aiRequest: 1000, delivery: 100 },
      pausedMs: 4000,
      totalMs: 1200,
    });
  });

  it("counts a still-open pause against totalMs when finish is called without resume", () => {
    // start=0, aiRequest mark=100 (delta 100), pause=100, finish=5000 while
    // still paused: the open pause (4900ms) must count toward pausedMs and be
    // excluded from totalMs, not inflate it.
    const timer = startLatencyTimer({
      scope: "correction.latency",
      message: "Transform latency",
      now: stepClock([0, 100, 100, 5000]),
    });

    timer.mark("aiRequest");
    timer.pause();
    timer.finish({ outcome: "failed" });

    const [, , context] = infoMock.mock.calls[0];
    expect(context).toEqual({
      outcome: "failed",
      phases: { aiRequest: 100 },
      pausedMs: 4900,
      totalMs: 100,
    });
  });

  it("admits every guard outcome to LatencyOutcome and still lets the first finish win", () => {
    const guardOutcomes: readonly LatencyOutcome[] = [
      "denied-app",
      "declined-size",
      "declined-stale",
      "declined-unknown-age",
      "secret-declined",
    ];

    for (const outcome of guardOutcomes) {
      vi.clearAllMocks();
      const timer = startLatencyTimer({
        scope: "correction.latency",
        message: "Transform latency",
        now: stepClock([0, 10]),
      });

      timer.finish({ outcome });
      timer.finish({ outcome: "failed" });

      expect(infoMock).toHaveBeenCalledTimes(1);
      expect(infoMock.mock.calls[0][2]).toMatchObject({ outcome });
    }
  });

  it("pins a guard outcome value as redaction-safe — 'stale-clipboard' is a VALUE, not a key", () => {
    // redactLogContext key-matches `clipboard` as a substring on KEY names
    // only; redactLogMessage (run on string VALUES) has no such rule. The
    // next reader will correctly flinch at a value containing "clipboard" —
    // this pins that it is safe.
    expect(redactLogContext({ outcome: "stale-clipboard" })).toEqual({
      outcome: "stale-clipboard",
    });
  });
});
