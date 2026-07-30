import {
  logEntryMatchesLevels,
  logEntryMatchesSearch,
} from "~/features/logs/shared/logging";
import type { LogEntry, LogLevel } from "~/features/logs/shared/logging";

/** Stable virtual-row identity; indexes change whenever live entries prepend. */
export const logRowKey = (
  entries: readonly LogEntry[],
  index: number,
): string | number => entries[index]?.id ?? index;

/**
 * Applies the dashboard level and case-insensitive text filters. An empty
 * `levels` selection means "every level" (see `normalizeLogLevels`).
 */
export const filterLogs = (
  entries: readonly LogEntry[],
  levels: readonly LogLevel[],
  search: string,
): LogEntry[] =>
  entries.filter(
    (entry) =>
      logEntryMatchesLevels(entry, levels) &&
      logEntryMatchesSearch(entry, search),
  );

/**
 * `UTC+09:00` / `UTC-05:30` / `UTC` from a `Date#getTimezoneOffset()` value
 * (minutes *behind* UTC, so the sign is inverted here).
 */
export const utcOffsetLabel = (offsetMinutes: number): string => {
  const minutesAheadOfUtc = -offsetMinutes;
  if (minutesAheadOfUtc === 0) {
    return "UTC";
  }
  const sign = minutesAheadOfUtc > 0 ? "+" : "-";
  const absolute = Math.abs(minutesAheadOfUtc);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
};

/**
 * `Asia/Tokyo (UTC+09:00)` — shown once in the logs footer so row timestamps
 * can drop their per-entry offset. Falls back to the offset alone when the
 * IANA zone name is unavailable.
 */
export const timeZoneLabel = (date: Date, zoneName?: string): string => {
  const offset = utcOffsetLabel(date.getTimezoneOffset());
  return zoneName === undefined || zoneName.length === 0
    ? offset
    : `${zoneName} (${offset})`;
};
