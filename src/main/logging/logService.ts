import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  appendToRing,
  formatLogEntries,
  logDayKey,
  redactLogContext,
  redactLogMessage,
  serializeLogJsonLine,
} from "~/shared/logging";
import {
  LOG_JSONL_FILENAME,
  queryPersistedLogs,
  readAllPersistedLogs,
} from "./logPersistence";
import type {
  LogContext,
  LogEntry,
  LogLevel,
  LogQueryRequest,
  LogQueryResult,
} from "~/shared/logging";

const DEFAULT_CAPACITY = 500;

type LogListener = (entry: LogEntry) => void;

class LogService {
  private entries: LogEntry[] = [];
  private readonly listeners = new Set<LogListener>();
  private persistenceDirectory: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /** Enables async append-only persistence below Electron userData. */
  public enablePersistence(userDataDirectory: string): void {
    this.persistenceDirectory = path.join(userDataDirectory, "logs");
  }

  /** Adds one redacted entry to memory and schedules optional disk append. */
  public log(
    level: LogLevel,
    scope: string,
    message: string,
    context?: LogContext,
  ): LogEntry {
    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      scope: redactLogMessage(scope),
      message: redactLogMessage(message),
      ...(context ? { context: redactLogContext(context) } : {}),
    };

    this.entries = appendToRing(this.entries, entry, this.capacity);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // A dashboard listener must not interrupt app logging.
      }
    }
    this.scheduleAppend(entry);
    return entry;
  }

  /** Returns newest bounded in-memory entries in chronological order. */
  public getRecent(limit: number = this.capacity): LogEntry[] {
    const safeLimit = Math.max(0, Math.min(this.capacity, Math.floor(limit)));
    return safeLimit === 0 ? [] : this.entries.slice(-safeLimit);
  }

  /**
   * Queries persisted day-folder JSONL logs newest-first with a cursor for
   * infinite scroll. Falls back to an empty page when persistence is off.
   */
  public async query(request: LogQueryRequest = {}): Promise<LogQueryResult> {
    const directory = this.persistenceDirectory;
    if (directory === null) {
      return { entries: [], nextCursor: null, hasMore: false };
    }
    // Flush pending writes so the latest entries are visible on disk.
    await this.writeQueue;
    return queryPersistedLogs(directory, request);
  }

  /**
   * Clears memory and removes all day-folder log files under the persistence
   * directory after pending writes.
   */
  public async clear(): Promise<void> {
    this.entries = [];
    const directory = this.persistenceDirectory;
    if (directory === null) {
      return;
    }
    this.writeQueue = this.writeQueue
      .then(async () => {
        await rm(directory, { recursive: true, force: true });
        await mkdir(directory, { recursive: true });
      })
      .catch(() => {
        // Clearing diagnostics must not break future log writes.
      });
    await this.writeQueue;
  }

  /**
   * Formats redacted plain text from all persisted entries (fallback: memory).
   * Used by copy/export so history survives app reloads.
   */
  public async formatAll(): Promise<string> {
    const directory = this.persistenceDirectory;
    if (directory === null) {
      return formatLogEntries(this.entries);
    }
    await this.writeQueue;
    const persisted = await readAllPersistedLogs(directory);
    return formatLogEntries(persisted.length > 0 ? persisted : this.entries);
  }

  /** Produces redacted plain text from current in-memory entries. */
  public formatRecent(): string {
    return formatLogEntries(this.entries);
  }

  /** Subscribes to future entries and returns cleanup callback. */
  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Resolves `{logs}/{YYYY-MM-DD}/fixlang.jsonl` for the entry's local calendar
   * day. Returns null when persistence is disabled.
   */
  private getLogPathForEntry(entry: LogEntry): string | null {
    if (this.persistenceDirectory === null) {
      return null;
    }
    const dayFolder = logDayKey(new Date(entry.timestamp));
    return path.join(this.persistenceDirectory, dayFolder, LOG_JSONL_FILENAME);
  }

  private scheduleAppend(entry: LogEntry): void {
    const logPath = this.getLogPathForEntry(entry);
    if (logPath === null) {
      return;
    }

    const line = `${serializeLogJsonLine(entry)}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(path.dirname(logPath), { recursive: true });
        await appendFile(logPath, line, "utf8");
      })
      .catch(() => {
        // Logging must never crash app flow. Keep future queue writes alive.
      });
  }
}

export const logService = new LogService();

/** Structured logger facade used by main-process features. */
export const logger = {
  debug: (scope: string, message: string, context?: LogContext): LogEntry =>
    logService.log("debug", scope, message, context),
  info: (scope: string, message: string, context?: LogContext): LogEntry =>
    logService.log("info", scope, message, context),
  warn: (scope: string, message: string, context?: LogContext): LogEntry =>
    logService.log("warn", scope, message, context),
  error: (scope: string, message: string, context?: LogContext): LogEntry =>
    logService.log("error", scope, message, context),
};
