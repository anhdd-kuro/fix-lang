/**
 * @file securityStats.ts
 * @description Pure roll-up of guard-rail activity out of redacted structured
 * log entries. Electron-free and side-effect-free, so the whole counting policy
 * is testable without a running app or a logs directory.
 *
 * Why the logs and not a counter store: every guard already writes one
 * structured line per event, with the counts the dashboard wants
 * (`matchCount`, `placeholderCount`, `ruleIds`) already on it. A second set of
 * numbers incremented beside those lines could disagree with them, and the
 * disagreement would be invisible. The cost of reading the log instead is that
 * `logs:clear` also clears these stats — stated in the panel, not hidden.
 *
 * Two things this deliberately cannot report:
 *
 * 1. **A denominator.** A guard that allows logs nothing, so "3 blocked out of
 *    N presses" is not derivable here. Every number below is a count of times a
 *    guard ACTED. Do not divide them by a transform count from history: that is
 *    a different population (per-preset rows, no combos, no Ask context reads)
 *    and the ratio would look authoritative while being wrong.
 * 2. **A confirm that the user accepted.** Only declines are logged, on purpose
 *    (an accepted confirm continues into the normal request path and its own
 *    log line). `secretConfirmed` is the one exception, because the secret gate
 *    logs both arms of its dialog.
 *
 * Event identification uses the `guardEvent` / `gateDecision` context keys, not
 * the message prose: a message is a sentence for a human reader and rewording
 * one must never silently zero a metric. Both key names survive
 * `redactLogContext` (see `~/features/secretGuard/shared/logKeys.test.ts`).
 */
import type { LogEntry } from "~/features/logs/shared/logging";

/** Matches the dashboard's shared analytics range pills (`AnalyticsRange`). */
export type SecurityStatsRange = "all" | "30d" | "7d";

export const SECURITY_STATS_RANGES: readonly SecurityStatsRange[] = ["all", "30d", "7d"];

const RANGE_DAYS: Record<Exclude<SecurityStatsRange, "all">, number> = {
  "30d": 30,
  "7d": 7,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const isSecurityStatsRange = (value: unknown): value is SecurityStatsRange =>
  typeof value === "string" && SECURITY_STATS_RANGES.includes(value as SecurityStatsRange);

/**
 * What a selection guard did, as written to the `guardEvent` context key.
 * `context-dropped` is Ask's outcome and is NOT a decline: the request went
 * ahead without the selection attached.
 */
export type SelectionGuardEvent = "blocked" | "declined" | "context-dropped";

/** Scope of the secret-gate log line — the only place `gateDecision` is written. */
export const SECRET_GATE_SCOPE = "secretGuard.gate";

/** Scope of the mask-restore failure line (reply kept its placeholders). */
export const SECRET_MASK_SCOPE = "secretGuard.mask";

export type SecurityStats = {
  /** Frontmost app was on the deny-list; nothing was sent. */
  blockedByApp: number;
  /** Cancelled at a size-cap confirm. */
  declinedLargeSelection: number;
  /** Cancelled at a stale-clipboard confirm. */
  declinedStaleClipboard: number;
  /** Cancelled at an unknown-clipboard-age confirm. */
  declinedUnknownClipboardAge: number;
  /** Ask ran without its selection because a guard fired on that selection. */
  askContextDropped: number;
  /** Secret dialog answered "Send anyway". */
  secretConfirmed: number;
  /** Secret dialog cancelled. */
  secretDeclined: number;
  /** Requests that left with placeholders in place of real values. */
  secretMasked: number;
  /** Values matched across those masked requests. */
  maskedValues: number;
  /** Placeholders substituted across those masked requests (deduped values). */
  maskedPlaceholders: number;
  /** Replies whose placeholders could not be restored, so nothing was pasted. */
  restoreFailures: number;
  /** Events per detector rule id, counted once per event that named the rule. */
  ruleCounts: Readonly<Record<string, number>>;
  /** ISO timestamp of the newest counted event, or null when there are none. */
  lastEventAt: string | null;
  /** Total counted events — the sum of every count above except the sums. */
  eventCount: number;
};

export const EMPTY_SECURITY_STATS: SecurityStats = Object.freeze({
  blockedByApp: 0,
  declinedLargeSelection: 0,
  declinedStaleClipboard: 0,
  declinedUnknownClipboardAge: 0,
  askContextDropped: 0,
  secretConfirmed: 0,
  secretDeclined: 0,
  secretMasked: 0,
  maskedValues: 0,
  maskedPlaceholders: 0,
  restoreFailures: 0,
  ruleCounts: Object.freeze({}),
  lastEventAt: null,
  eventCount: 0,
});

const contextString = (entry: LogEntry, key: string): string | null => {
  const value = entry.context?.[key];
  return typeof value === "string" ? value : null;
};

const contextCount = (entry: LogEntry, key: string): number => {
  const value = entry.context?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
};

const contextRuleIds = (entry: LogEntry): string[] => {
  const value = entry.context?.ruleIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
};

/**
 * Cheap per-entry filter so a caller walking day files keeps only the handful
 * of guard lines in memory instead of the whole log. Kept in step with
 * `summarizeSecurityStats` by construction: anything it would not count is
 * rejected here.
 */
export const isSecurityEvent = (entry: LogEntry): boolean => {
  if (entry.scope === SECRET_MASK_SCOPE) return true;
  if (entry.scope === SECRET_GATE_SCOPE) return contextString(entry, "gateDecision") !== null;
  return contextString(entry, "guardEvent") !== null;
};

/**
 * Newest counted timestamp. String compare is correct for ISO-8601 UTC
 * timestamps, which is what `logService` writes (`toISOString()`).
 */
const newerTimestamp = (current: string | null, candidate: string): string =>
  current === null || candidate.localeCompare(current) > 0 ? candidate : current;

type MutableStats = {
  -readonly [Key in keyof SecurityStats]: Key extends "ruleCounts"
    ? Record<string, number>
    : SecurityStats[Key];
};

const blankStats = (): MutableStats => ({
  ...EMPTY_SECURITY_STATS,
  ruleCounts: {},
});

const countSelectionGuardEvent = (stats: MutableStats, entry: LogEntry): boolean => {
  const event = contextString(entry, "guardEvent");
  const reason = contextString(entry, "guardReason");

  if (event === "blocked") {
    stats.blockedByApp += 1;
    return true;
  }
  if (event === "context-dropped") {
    stats.askContextDropped += 1;
    return true;
  }
  if (event !== "declined") return false;

  // An unrecognised reason is dropped rather than folded into a neighbouring
  // bucket: a new confirm reason must show up as a missing metric, never as an
  // inflated existing one.
  if (reason === "large-selection") {
    stats.declinedLargeSelection += 1;
    return true;
  }
  if (reason === "stale-clipboard") {
    stats.declinedStaleClipboard += 1;
    return true;
  }
  if (reason === "unknown-clipboard-age") {
    stats.declinedUnknownClipboardAge += 1;
    return true;
  }
  return false;
};

const countSecretGateEvent = (stats: MutableStats, entry: LogEntry): boolean => {
  const decision = contextString(entry, "gateDecision");

  if (decision === "confirmed") {
    stats.secretConfirmed += 1;
  } else if (decision === "declined") {
    stats.secretDeclined += 1;
  } else if (decision === "masked") {
    stats.secretMasked += 1;
    stats.maskedValues += contextCount(entry, "matchCount");
    stats.maskedPlaceholders += contextCount(entry, "placeholderCount");
  } else {
    return false;
  }

  for (const ruleId of new Set(contextRuleIds(entry))) {
    stats.ruleCounts[ruleId] = (stats.ruleCounts[ruleId] ?? 0) + 1;
  }
  return true;
};

/**
 * Folds redacted log entries into one roll-up. Order-independent, so a caller
 * may pass day files in any order.
 */
export const summarizeSecurityStats = (entries: Iterable<LogEntry>): SecurityStats => {
  const stats = blankStats();

  const countOne = (entry: LogEntry): boolean => {
    if (entry.scope === SECRET_MASK_SCOPE) {
      stats.restoreFailures += 1;
      return true;
    }
    return entry.scope === SECRET_GATE_SCOPE
      ? countSecretGateEvent(stats, entry)
      : countSelectionGuardEvent(stats, entry);
  };

  for (const entry of entries) {
    if (countOne(entry)) {
      stats.eventCount += 1;
      stats.lastEventAt = newerTimestamp(stats.lastEventAt, entry.timestamp);
    }
  }

  return stats;
};

/** Detector rules by event count, ties broken by rule id for a stable order. */
export const topSecurityRules = (
  stats: SecurityStats,
  limit: number,
): { ruleId: string; count: number }[] =>
  Object.entries(stats.ruleCounts)
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((left, right) => right.count - left.count || left.ruleId.localeCompare(right.ruleId))
    .slice(0, Math.max(0, Math.floor(limit)));

/**
 * Exclusive lower bound for a range, or null for "all". Injected `now` keeps
 * callers and tests deterministic.
 */
export const securityStatsCutoff = (range: SecurityStatsRange, now: Date): Date | null =>
  range === "all" ? null : new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);

/**
 * Whether a `YYYY-MM-DD` day folder can hold entries at or after `cutoff`.
 *
 * Day folders are LOCAL calendar days while entry timestamps are UTC, so the
 * cutoff day itself is compared inclusively and one extra older day is kept:
 * a local day can hold UTC timestamps that fall either side of it, and reading
 * one surplus file costs a filter pass while dropping one loses real events.
 */
export const dayFolderInRange = (dayKey: string, cutoff: Date | null): boolean => {
  if (cutoff === null) return true;
  const oneDayBefore = new Date(cutoff.getTime() - DAY_MS);
  const year = String(oneDayBefore.getFullYear());
  const month = String(oneDayBefore.getMonth() + 1).padStart(2, "0");
  const day = String(oneDayBefore.getDate()).padStart(2, "0");
  return dayKey.localeCompare(`${year}-${month}-${day}`) >= 0;
};

/** Entry-level range filter, applied after the coarse day-folder prune. */
export const entryInRange = (entry: LogEntry, cutoff: Date | null): boolean => {
  if (cutoff === null) return true;
  const at = new Date(entry.timestamp).getTime();
  return Number.isFinite(at) && at >= cutoff.getTime();
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isRuleCounts = (value: unknown): value is Record<string, number> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(isNonNegativeInteger);

const COUNT_KEYS: readonly (keyof SecurityStats)[] = [
  "blockedByApp",
  "declinedLargeSelection",
  "declinedStaleClipboard",
  "declinedUnknownClipboardAge",
  "askContextDropped",
  "secretConfirmed",
  "secretDeclined",
  "secretMasked",
  "maskedValues",
  "maskedPlaceholders",
  "restoreFailures",
  "eventCount",
];

/** Type guard for the IPC payload — validated independently on both sides. */
export const isSecurityStats = (value: unknown): value is SecurityStats => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    COUNT_KEYS.every((key) => isNonNegativeInteger(record[key])) &&
    isRuleCounts(record.ruleCounts) &&
    (record.lastEventAt === null || typeof record.lastEventAt === "string")
  );
};
