/** Supported structured-log severities, ordered from least to most severe. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** JSON-safe values accepted as structured log metadata. */
export type LogValue =
  string | number | boolean | null | LogValue[] | { [key: string]: LogValue };

/** Metadata attached to a log entry. */
export type LogContext = Record<string, LogValue>;

/** Redacted log record shared between main, preload, and renderer. */
export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  context?: LogContext;
};

const REDACTED = "[REDACTED]";

/**
 * Local calendar day key for on-disk log layout:
 * `{userData}/logs/{YYYY-MM-DD}/fixlang.log`
 */
export const logDayKey = (date: Date): string => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|bearer|token|secret|password|clipboard|selected[-_]?text|original[-_]?text)/i;

/**
 * Removes common credential forms from free-form messages.
 * Clipboard content is protected structurally by sensitive context-key redaction.
 */
export const redactLogMessage = (message: string): string =>
  message
    .replace(/\b(?:sk|or)-[a-z0-9][a-z0-9._-]{5,}\b/gi, REDACTED)
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(
      /\b(api[-_]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      `$1=${REDACTED}`,
    )
    .replace(/\b(openrouter_api_key)\s*[:=]\s*[^\s,;]+/gi, `$1=${REDACTED}`);

const redactLogValue = (value: LogValue): LogValue => {
  if (typeof value === "string") {
    return redactLogMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item));
  }
  if (value !== null && typeof value === "object") {
    return redactLogContext(value);
  }
  return value;
};

/** Recursively redacts sensitive metadata fields and credential-like strings. */
export const redactLogContext = (context: LogContext): LogContext =>
  Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactLogValue(value),
    ]),
  );

/** Adds one entry to an immutable bounded ring, trimming oldest entries first. */
export const appendToRing = (
  entries: readonly LogEntry[],
  entry: LogEntry,
  capacity: number,
): LogEntry[] => {
  const safeCapacity = Math.max(0, Math.floor(capacity));
  if (safeCapacity === 0) {
    return [];
  }
  return [...entries, entry].slice(-safeCapacity);
};

/** Formats redacted entries for clipboard and plain-text export. */
export const formatLogEntries = (entries: readonly LogEntry[]): string =>
  entries
    .map((entry) => {
      const context = entry.context
        ? ` ${JSON.stringify(redactLogContext(entry.context))}`
        : "";
      return [
        `[${entry.timestamp}]`,
        `[${entry.level.toUpperCase()}]`,
        `[${entry.scope}]`,
        `${redactLogMessage(entry.message)}${context}`,
      ].join(" ");
    })
    .join("\n");

/** Default page size for disk-backed log queries (newest-first). */
export const LOG_QUERY_PAGE_SIZE = 100;

/** Cursor-based query against persisted day-folder logs. */
export type LogQueryRequest = {
  /** Exclusive upper bound — return entries strictly older than this ISO time. */
  beforeTimestamp?: string;
  limit?: number;
  level?: LogLevel | "all";
  search?: string;
};

/** One page of newest-first log entries plus a cursor for older history. */
export type LogQueryResult = {
  entries: LogEntry[];
  /** Oldest timestamp in `entries`; pass as `beforeTimestamp` for the next page. */
  nextCursor: string | null;
  hasMore: boolean;
};

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLogValue = (value: unknown): value is LogValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isLogValue(item));
  }
  return (
    isRecord(value) && Object.values(value).every((item) => isLogValue(item))
  );
};

const isLogContext = (value: unknown): value is LogContext =>
  isRecord(value) && Object.values(value).every((item) => isLogValue(item));

/** Type guard for a persisted / IPC log entry. */
export const isLogEntry = (value: unknown): value is LogEntry =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.timestamp === "string" &&
  typeof value.level === "string" &&
  LOG_LEVELS.has(value.level as LogLevel) &&
  typeof value.scope === "string" &&
  typeof value.message === "string" &&
  (value.context === undefined || isLogContext(value.context));

/** Serializes one entry as a JSONL line (no trailing newline). */
export const serializeLogJsonLine = (entry: LogEntry): string =>
  JSON.stringify(entry);

/** Parses one JSONL line into a LogEntry, or null if invalid. */
export const parseLogJsonLine = (line: string): LogEntry | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isLogEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Case-insensitive text match used by disk query and dashboard filters. */
export const logEntryMatchesSearch = (
  entry: LogEntry,
  search: string,
): boolean => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
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
};

