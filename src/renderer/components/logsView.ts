import type { LogEntry, LogLevel } from "~/shared/logging";

export type LogLevelFilter = LogLevel | "all";

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
