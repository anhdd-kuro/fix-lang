/**
 * @file logPersistence.ts
 * @description Day-folder JSONL read/write helpers for structured logs under
 * `{userData}/logs/{YYYY-MM-DD}/fixlang.jsonl`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  logEntryMatchesSearch,
  LOG_QUERY_PAGE_SIZE,
  parseLogJsonLine,
} from "~/shared/logging";
import type {
  LogEntry,
  LogLevel,
  LogQueryRequest,
  LogQueryResult,
} from "~/shared/logging";

export const LOG_JSONL_FILENAME = "fixlang.jsonl";

const DAY_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Lists local-day folder names newest-first under the logs root. */
export const listDayFoldersNewestFirst = async (
  logsDirectory: string,
): Promise<string[]> => {
  try {
    const names = await readdir(logsDirectory, { withFileTypes: true });
    return names
      .filter((entry) => entry.isDirectory() && DAY_FOLDER_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
};

/** Reads and parses one day file; returns chronological (oldest-first) entries. */
export const readDayLogEntries = async (
  logsDirectory: string,
  dayKey: string,
): Promise<LogEntry[]> => {
  const filePath = path.join(logsDirectory, dayKey, LOG_JSONL_FILENAME);
  try {
    const raw = await readFile(filePath, "utf8");
    const entries: LogEntry[] = [];
    for (const line of raw.split("\n")) {
      const entry = parseLogJsonLine(line);
      if (entry !== null) {
        entries.push(entry);
      }
    }
    return entries;
  } catch {
    return [];
  }
};

const normalizeQuery = (
  request: LogQueryRequest,
): {
  beforeTimestamp: string | undefined;
  limit: number;
  level: LogLevel | "all";
  search: string;
} => {
  const limitRaw = request.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
      : LOG_QUERY_PAGE_SIZE;
  const level = request.level ?? "all";
  return {
    beforeTimestamp:
      typeof request.beforeTimestamp === "string" &&
      request.beforeTimestamp.length > 0
        ? request.beforeTimestamp
        : undefined,
    limit,
    level: level === "all" || level === "debug" || level === "info" || level === "warn" || level === "error"
      ? level
      : "all",
    search: typeof request.search === "string" ? request.search : "",
  };
};

const matchesFilters = (
  entry: LogEntry,
  level: LogLevel | "all",
  search: string,
  beforeTimestamp: string | undefined,
): boolean => {
  if (
    beforeTimestamp !== undefined &&
    entry.timestamp.localeCompare(beforeTimestamp) >= 0
  ) {
    return false;
  }
  if (level !== "all" && entry.level !== level) {
    return false;
  }
  return logEntryMatchesSearch(entry, search);
};

/**
 * Walks day folders newest-first and returns one page of matching entries
 * (newest first within the page).
 */
export const queryPersistedLogs = async (
  logsDirectory: string,
  request: LogQueryRequest = {},
): Promise<LogQueryResult> => {
  const { beforeTimestamp, limit, level, search } = normalizeQuery(request);
  const days = await listDayFoldersNewestFirst(logsDirectory);
  const collected: LogEntry[] = [];
  let scannedPastPage = false;

  for (const day of days) {
    const dayEntries = await readDayLogEntries(logsDirectory, day);
    // File is append-only oldest→newest; reverse for newest-first walk.
    for (let index = dayEntries.length - 1; index >= 0; index -= 1) {
      const entry = dayEntries[index];
      if (entry === undefined) {
        continue;
      }
      if (!matchesFilters(entry, level, search, beforeTimestamp)) {
        continue;
      }
      if (collected.length >= limit) {
        scannedPastPage = true;
        break;
      }
      collected.push(entry);
    }
    if (scannedPastPage) {
      break;
    }
  }

  const oldest = collected.length > 0 ? collected[collected.length - 1] : undefined;
  return {
    entries: collected,
    nextCursor: oldest !== undefined ? oldest.timestamp : null,
    hasMore: scannedPastPage,
  };
};

/** Loads every persisted entry oldest→newest (for copy/export). */
export const readAllPersistedLogs = async (
  logsDirectory: string,
): Promise<LogEntry[]> => {
  const days = await listDayFoldersNewestFirst(logsDirectory);
  // days are newest-first; reverse to oldest-first day order for export.
  const chronological: LogEntry[] = [];
  for (const day of [...days].reverse()) {
    const dayEntries = await readDayLogEntries(logsDirectory, day);
    chronological.push(...dayEntries);
  }
  return chronological;
};
