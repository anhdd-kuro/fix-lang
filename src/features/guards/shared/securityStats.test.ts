/**
 * @file securityStats.test.ts
 * @description Pins the counting policy, and the two ways a metric dies
 * silently: an unrecognised reason folded into a neighbouring bucket, and a
 * redacted context key read as if it were still a number.
 */
import { describe, expect, it } from "vitest";
import { redactLogContext } from "~/features/logs/shared/logging";
import {
  dayFolderInRange,
  EMPTY_SECURITY_STATS,
  entryInRange,
  isSecurityEvent,
  isSecurityStats,
  isSecurityStatsRange,
  SECRET_GATE_SCOPE,
  SECRET_MASK_SCOPE,
  securityStatsCutoff,
  summarizeSecurityStats,
  topSecurityRules,
} from "./securityStats";
import type { LogContext, LogEntry, LogLevel } from "~/features/logs/shared/logging";

let idCounter = 0;

const entry = (
  scope: string,
  context: LogContext,
  overrides: { timestamp?: string; level?: LogLevel } = {},
): LogEntry => {
  idCounter += 1;
  return {
    id: `entry-${String(idCounter)}`,
    timestamp: overrides.timestamp ?? "2026-08-11T10:00:00.000Z",
    level: overrides.level ?? "info",
    scope,
    message: "Guard event",
    // The REAL redactor, so no test passes on a key the logger would blank.
    context: redactLogContext(context),
  };
};

const selectionGuard = (
  guardEvent: string,
  guardReason: string,
  timestamp?: string,
): LogEntry =>
  entry("correction.hotkey", { presetId: "correction", guardEvent, guardReason }, { timestamp });

const secretGate = (context: LogContext, timestamp?: string): LogEntry =>
  entry(SECRET_GATE_SCOPE, context, { timestamp });

describe("summarizeSecurityStats", () => {
  it("returns the empty roll-up for no entries", () => {
    expect(summarizeSecurityStats([])).toEqual(EMPTY_SECURITY_STATS);
  });

  it("counts each selection-guard outcome in its own bucket", () => {
    const stats = summarizeSecurityStats([
      selectionGuard("blocked", "denied-app"),
      selectionGuard("declined", "large-selection"),
      selectionGuard("declined", "stale-clipboard"),
      selectionGuard("declined", "stale-clipboard"),
      selectionGuard("declined", "unknown-clipboard-age"),
      selectionGuard("context-dropped", "denied-app"),
    ]);

    expect(stats.blockedByApp).toBe(1);
    expect(stats.declinedLargeSelection).toBe(1);
    expect(stats.declinedStaleClipboard).toBe(2);
    expect(stats.declinedUnknownClipboardAge).toBe(1);
    expect(stats.askContextDropped).toBe(1);
    expect(stats.eventCount).toBe(6);
  });

  /**
   * A fourth confirm reason added to `selectionGuards.ts` must read as a missing
   * metric, not as extra stale-clipboard declines.
   */
  it("drops a decline whose reason it does not recognise instead of guessing", () => {
    const stats = summarizeSecurityStats([selectionGuard("declined", "some-future-reason")]);

    expect(stats).toEqual(EMPTY_SECURITY_STATS);
  });

  it("counts both arms of the secret dialog and the masked path", () => {
    const stats = summarizeSecurityStats([
      secretGate({ gateDecision: "confirmed", matchCount: 2, ruleIds: ["openai-key"] }),
      secretGate({ gateDecision: "declined", matchCount: 1, ruleIds: ["jwt"] }),
      secretGate({
        gateDecision: "masked",
        matchCount: 3,
        placeholderCount: 2,
        ruleIds: ["openai-key", "aws-access-key-id"],
      }),
    ]);

    expect(stats.secretConfirmed).toBe(1);
    expect(stats.secretDeclined).toBe(1);
    expect(stats.secretMasked).toBe(1);
    expect(stats.maskedValues).toBe(3);
    expect(stats.maskedPlaceholders).toBe(2);
    expect(stats.ruleCounts).toEqual({ "openai-key": 2, jwt: 1, "aws-access-key-id": 1 });
  });

  /** `gateDecision: "allow"` is never logged, but must not become an event. */
  it("ignores a secret-gate line with no countable decision", () => {
    expect(summarizeSecurityStats([secretGate({ gateDecision: "allow" })])).toEqual(
      EMPTY_SECURITY_STATS,
    );
  });

  it("counts a rule once per event even when it matched twice in one selection", () => {
    const stats = summarizeSecurityStats([
      secretGate({ gateDecision: "masked", matchCount: 2, ruleIds: ["jwt", "jwt"] }),
    ]);

    expect(stats.ruleCounts).toEqual({ jwt: 1 });
  });

  it("counts a failed restore and keeps it out of the masked counters", () => {
    const stats = summarizeSecurityStats([
      entry(SECRET_MASK_SCOPE, { appliedMode: "mask-and-restore", missingCount: 1 }),
    ]);

    expect(stats.restoreFailures).toBe(1);
    expect(stats.secretMasked).toBe(0);
    expect(stats.eventCount).toBe(1);
  });

  it("ignores ordinary log lines that carry no guard keys", () => {
    const stats = summarizeSecurityStats([
      entry("correction.hotkey", { presetId: "correction", delivery: "paste" }),
      entry("logs", {}),
    ]);

    expect(stats).toEqual(EMPTY_SECURITY_STATS);
  });

  it("reports the newest timestamp regardless of input order", () => {
    const older = selectionGuard("blocked", "denied-app", "2026-08-01T00:00:00.000Z");
    const newer = selectionGuard("blocked", "denied-app", "2026-08-09T23:59:59.000Z");

    expect(summarizeSecurityStats([newer, older]).lastEventAt).toBe(newer.timestamp);
    expect(summarizeSecurityStats([older, newer]).lastEventAt).toBe(newer.timestamp);
  });

  /** A rename to `secretCount`/`clipboardStale` would zero every number here. */
  it("survives the real redactor with numbers intact", () => {
    const stats = summarizeSecurityStats([
      secretGate({ gateDecision: "masked", matchCount: 5, placeholderCount: 4, ruleIds: ["jwt"] }),
    ]);

    expect(stats.maskedValues).toBe(5);
    expect(stats.maskedPlaceholders).toBe(4);
  });
});

describe("isSecurityEvent", () => {
  it("keeps exactly what the roll-up counts", () => {
    expect(isSecurityEvent(selectionGuard("blocked", "denied-app"))).toBe(true);
    expect(isSecurityEvent(secretGate({ gateDecision: "masked" }))).toBe(true);
    expect(isSecurityEvent(entry(SECRET_MASK_SCOPE, { missingCount: 1 }))).toBe(true);
    expect(isSecurityEvent(entry(SECRET_GATE_SCOPE, { guardMode: "mask" }))).toBe(false);
    expect(isSecurityEvent(entry("correction.hotkey", { delivery: "paste" }))).toBe(false);
  });
});

describe("topSecurityRules", () => {
  it("orders by count then rule id and honours the limit", () => {
    const stats = summarizeSecurityStats([
      secretGate({ gateDecision: "masked", ruleIds: ["jwt"] }),
      secretGate({ gateDecision: "masked", ruleIds: ["jwt"] }),
      secretGate({ gateDecision: "masked", ruleIds: ["openai-key"] }),
      secretGate({ gateDecision: "masked", ruleIds: ["aws-access-key-id"] }),
    ]);

    expect(topSecurityRules(stats, 2)).toEqual([
      { ruleId: "jwt", count: 2 },
      { ruleId: "aws-access-key-id", count: 1 },
    ]);
    expect(topSecurityRules(stats, 0)).toEqual([]);
  });
});

describe("range windowing", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");

  it("has no cutoff for `all`", () => {
    expect(securityStatsCutoff("all", now)).toBeNull();
    expect(dayFolderInRange("2019-01-01", null)).toBe(true);
    expect(entryInRange(selectionGuard("blocked", "denied-app", "2019-01-01T00:00:00.000Z"), null)).toBe(
      true,
    );
  });

  it("keeps one surplus day folder because folders are local days and entries are UTC", () => {
    const cutoff = securityStatsCutoff("7d", now);

    expect(dayFolderInRange("2026-08-11", cutoff)).toBe(true);
    expect(dayFolderInRange("2026-08-04", cutoff)).toBe(true);
    // The day before the cutoff day is kept on purpose; the entry filter is
    // what makes the window exact.
    expect(dayFolderInRange("2026-08-03", cutoff)).toBe(true);
    expect(dayFolderInRange("2026-08-02", cutoff)).toBe(false);
  });

  it("filters entries exactly at the cutoff instant", () => {
    const cutoff = securityStatsCutoff("30d", now);

    expect(entryInRange(selectionGuard("blocked", "denied-app", "2026-07-12T12:00:00.000Z"), cutoff)).toBe(
      true,
    );
    expect(entryInRange(selectionGuard("blocked", "denied-app", "2026-07-12T11:59:59.000Z"), cutoff)).toBe(
      false,
    );
  });

  it("drops an unparseable timestamp rather than counting it in every range", () => {
    expect(entryInRange(selectionGuard("blocked", "denied-app", "not-a-date"), securityStatsCutoff("7d", now))).toBe(
      false,
    );
  });
});

describe("IPC payload guards", () => {
  it("accepts a real roll-up and rejects malformed ones", () => {
    expect(isSecurityStats(EMPTY_SECURITY_STATS)).toBe(true);
    expect(isSecurityStats({ ...EMPTY_SECURITY_STATS, blockedByApp: -1 })).toBe(false);
    expect(isSecurityStats({ ...EMPTY_SECURITY_STATS, blockedByApp: 1.5 })).toBe(false);
    expect(isSecurityStats({ ...EMPTY_SECURITY_STATS, ruleCounts: { jwt: "3" } })).toBe(false);
    expect(isSecurityStats({ ...EMPTY_SECURITY_STATS, lastEventAt: 17 })).toBe(false);
    expect(isSecurityStats(null)).toBe(false);
    expect(isSecurityStats([])).toBe(false);
  });

  it("accepts only the three range tokens", () => {
    expect(isSecurityStatsRange("all")).toBe(true);
    expect(isSecurityStatsRange("7d")).toBe(true);
    expect(isSecurityStatsRange("90d")).toBe(false);
    expect(isSecurityStatsRange(7)).toBe(false);
  });
});
