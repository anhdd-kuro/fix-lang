/**
 * @file logPersistence.ts
 * @description Day-folder JSONL read/write helpers for structured logs under
 * `{userData}/logs/{YYYY-MM-DD}/fixlang.jsonl`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  logEntryMatchesLevels,
  logEntryMatchesSearch,
  LOG_QUERY_PAGE_SIZE,
  normalizeLogLevels,
  parseLogJsonLine,
} from "~/features/logs/shared/logging";
import type {
  LogEntry,
  LogLevel,
  LogQueryRequest,
  LogQueryResult,
} from "~/features/logs/shared/logging";

export const LOG_JSONL_FILENAME = "fixlang.jsonl";

const DAY_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Lists local-day folder names newest-first under the logs root. */
export const listDayFoldersNewestFirst = async (
  logsDirectory: string,
): Promise<string[]> => {
  try {
    const names = await readdir(logsDirectory, { withFileTypes: true });
    return names
      .filter(
        (entry) => entry.isDirectory() && DAY_FOLDER_PATTERN.test(entry.name),
      )
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

type NormalizedLogQuery = {
  beforeTimestamp: string | undefined;
  limit: number;
  levels: LogLevel[];
  search: string;
};

/** `z.number()` already refuses NaN and ±Infinity, so only finite limits pass. */
const QueryLimitSchema = z.number();
const QueryBeforeTimestampSchema = z.string().min(1);
const QuerySearchSchema = z.string();

const normalizeQuery = (request: LogQueryRequest): NormalizedLogQuery => {
  const limitRaw = QueryLimitSchema.safeParse(request.limit);
  const limit = limitRaw.success
    ? Math.max(1, Math.min(500, Math.floor(limitRaw.data)))
    : LOG_QUERY_PAGE_SIZE;
  const beforeTimestamp = QueryBeforeTimestampSchema.safeParse(
    request.beforeTimestamp,
  );
  const search = QuerySearchSchema.safeParse(request.search);
  return {
    beforeTimestamp: beforeTimestamp.success ? beforeTimestamp.data : undefined,
    limit,
    levels: normalizeLogLevels(request.levels),
    search: search.success ? search.data : "",
  };
};

const matchesFilters = (
  entry: LogEntry,
  levels: readonly LogLevel[],
  search: string,
  beforeTimestamp: string | undefined,
): boolean => {
  if (
    beforeTimestamp !== undefined &&
    entry.timestamp.localeCompare(beforeTimestamp) >= 0
  ) {
    return false;
  }
  if (!logEntryMatchesLevels(entry, levels)) {
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
  const { beforeTimestamp, limit, levels, search } = normalizeQuery(request);
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
      if (!matchesFilters(entry, levels, search, beforeTimestamp)) {
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

  const oldest =
    collected.length > 0 ? collected[collected.length - 1] : undefined;
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
