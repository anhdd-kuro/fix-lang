import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  appendToRing,
  formatLogEntries,
  redactLogContext,
  redactLogMessage,
} from "~/shared/logging";
import type { LogContext, LogEntry, LogLevel } from "~/shared/logging";

const DEFAULT_CAPACITY = 500;
const LOG_FILENAME = "fixlang.log";

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

  /** Returns newest bounded entries in chronological order. */
  public getRecent(limit: number = this.capacity): LogEntry[] {
    const safeLimit = Math.max(0, Math.min(this.capacity, Math.floor(limit)));
    return safeLimit === 0 ? [] : this.entries.slice(-safeLimit);
  }

  /** Clears memory and removes current persisted log after pending writes. */
  public async clear(): Promise<void> {
    this.entries = [];
    const logPath = this.getLogPath();
    if (logPath === null) {
      return;
    }
    this.writeQueue = this.writeQueue
      .then(async () => {
        await rm(logPath, { force: true });
      })
      .catch(() => {
        // Clearing diagnostics must not break future log writes.
      });
    await this.writeQueue;
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

  private getLogPath(): string | null {
    return this.persistenceDirectory === null
      ? null
      : path.join(this.persistenceDirectory, LOG_FILENAME);
  }

  private scheduleAppend(entry: LogEntry): void {
    const logPath = this.getLogPath();
    const directory = this.persistenceDirectory;
    if (logPath === null || directory === null) {
      return;
    }

    const line = `${formatLogEntries([entry])}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(directory, { recursive: true });
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
