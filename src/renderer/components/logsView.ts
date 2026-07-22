import type { LogEntry, LogLevel } from "~/shared/logging";

export type LogLevelFilter = LogLevel | "all";

/** Stable virtual-row identity; indexes change whenever live entries prepend. */
export const logRowKey = (
  entries: readonly LogEntry[],
  index: number,
): string | number => entries[index]?.id ?? index;

/** Applies dashboard level and case-insensitive text filters. */
export const filterLogs = (
  entries: readonly LogEntry[],
  level: LogLevelFilter,
  search: string,
): LogEntry[] => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (level !== "all" && entry.level !== level) {
      return false;
    }
    if (normalizedSearch.length === 0) {
      return true;
    }
    const searchable = [
      entry.timestamp,
      entry.level,
      entry.scope,
      entry.message,
      entry.context ? JSON.stringify(entry.context) : "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalizedSearch);
  });
};
