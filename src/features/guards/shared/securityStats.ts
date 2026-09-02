/**
 * @file securityStats.ts
 * @description Pure roll-up of guard-rail activity out of redacted structured
 * log entries.
 *
 * Read from the logs rather than a counter store because every guard already
 * writes one line per event carrying these counts, and a second set of numbers
 * beside those lines could disagree with them invisibly. The cost: `logs:clear`
 * also clears the roll-up.
 *
 * Events are identified by the `guardEvent` / `gateDecision` context keys, never
 * by message prose — rewording a log message must not zero a metric. Both key
 * names survive `redactLogContext` (`~/features/secretGuard/shared/logKeys.test.ts`).
 *
 * `guardEvent` did not exist before the roll-up did, so a selection-guard line
 * from an older build carries `guardReason` alone. Those lines are counted as
 * `legacyEvents` and named as such rather than classified: a legacy block and a
 * legacy Ask context-drop wrote the SAME context keys, which is exactly why
 * `guardEvent` was added. Counting them somewhere keeps `eventCount` honest, so
 * an archive of nothing but legacy lines can never render as "no guard fired".
 *
 * There is no denominator here and there cannot be: a guard that ALLOWS logs
 * nothing. Every count is a count of times a guard acted, and dividing one by a
 * transform count from history compares different populations.
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
 * Written to the `guardEvent` context key. `context-dropped` is Ask's outcome
 * and is NOT a decline: the request went ahead without the selection attached.
 */
export type SelectionGuardEvent = "blocked" | "declined" | "context-dropped";

export const SECRET_GATE_SCOPE = "secretGuard.gate";

export const SECRET_MASK_SCOPE = "secretGuard.mask";

export type SecurityStats = {
  blockedByApp: number;
  declinedLargeSelection: number;
  declinedStaleClipboard: number;
  declinedUnknownClipboardAge: number;
  askContextDropped: number;
  secretConfirmed: number;
  secretDeclined: number;
  /** Requests that left with placeholders in place of real values. */
  secretMasked: number;
  /** Values matched across those requests. */
  maskedValues: number;
  /** Placeholders substituted across them — deduped, so ≤ `maskedValues`. */
  maskedPlaceholders: number;
  /** Replies whose placeholders could not be restored, so nothing was pasted. */
  restoreFailures: number;
  /** Pre-`guardEvent` selection-guard lines: real events, not classifiable. */
  legacyEvents: number;
  /** Counted once per event that named the rule, not once per match. */
  ruleCounts: Readonly<Record<string, number>>;
  lastEventAt: string | null;
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
  legacyEvents: 0,
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
 * Lets a caller walking day files keep only the guard lines in memory. Rejects
 * exactly what `summarizeSecurityStats` would not count.
 */
export const isSecurityEvent = (entry: LogEntry): boolean => {
  if (entry.scope === SECRET_MASK_SCOPE) return true;
  if (entry.scope === SECRET_GATE_SCOPE) return contextString(entry, "gateDecision") !== null;
  return (
    contextString(entry, "guardEvent") !== null || contextString(entry, "guardReason") !== null
  );
};

/** String compare is correct here: `logService` writes ISO-8601 UTC timestamps. */
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

  if (event === null) {
    if (reason === null) return false;
    stats.legacyEvents += 1;
    return true;
  }
  if (event === "blocked") {
    stats.blockedByApp += 1;
    return true;
  }
  if (event === "context-dropped") {
    stats.askContextDropped += 1;
    return true;
  }
  if (event !== "declined") return false;

  // An unrecognised reason is dropped, never folded into a neighbouring bucket:
  // a new confirm reason must surface as a missing metric, not an inflated one.
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

/** Order-independent, so day files may arrive in any order. */
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

/** Ties break on rule id, so the order is stable across reads. */
export const topSecurityRules = (
  stats: SecurityStats,
  limit: number,
): { ruleId: string; count: number }[] =>
  Object.entries(stats.ruleCounts)
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((left, right) => right.count - left.count || left.ruleId.localeCompare(right.ruleId))
    .slice(0, Math.max(0, Math.floor(limit)));

/** `now` is injected to keep callers and tests deterministic. */
export const securityStatsCutoff = (range: SecurityStatsRange, now: Date): Date | null =>
  range === "all" ? null : new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);

/**
 * Day folders are LOCAL calendar days while entry timestamps are UTC, so one
 * extra older folder is kept: a local day holds UTC timestamps either side of
 * it. Reading a surplus file costs a filter pass; dropping one loses events.
 * `entryInRange` is what makes the window exact.
 */
export const dayFolderInRange = (dayKey: string, cutoff: Date | null): boolean => {
  if (cutoff === null) return true;
  const oneDayBefore = new Date(cutoff.getTime() - DAY_MS);
  const year = String(oneDayBefore.getFullYear());
  const month = String(oneDayBefore.getMonth() + 1).padStart(2, "0");
  const day = String(oneDayBefore.getDate()).padStart(2, "0");
  return dayKey.localeCompare(`${year}-${month}-${day}`) >= 0;
};

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
  "legacyEvents",
  "eventCount",
];

/** Validated independently on both sides of the IPC boundary. */
export const isSecurityStats = (value: unknown): value is SecurityStats => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    COUNT_KEYS.every((key) => isNonNegativeInteger(record[key])) &&
    isRuleCounts(record.ruleCounts) &&
    (record.lastEventAt === null || typeof record.lastEventAt === "string")
  );
};
