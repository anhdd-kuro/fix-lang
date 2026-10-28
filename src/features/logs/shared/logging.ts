import { z } from "zod";
import {
  AnyNumberSchema,
  everyItemSchema,
  NonArrayObjectSchema,
  schemaGuard,
} from "~/features/core/shared/schemaGuard";

/** Supported structured-log severities, ordered from least to most severe. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Every severity in severity order — display order for the dashboard filter. */
export const LOG_LEVEL_ORDER: readonly LogLevel[] = [
  "debug",
  "info",
  "warn",
  "error",
];

/** JSON-safe values accepted as structured log metadata. */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | LogValue[]
  | { [key: string]: LogValue };

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
 * A provider 401 body quotes the submitted key back partially starred
 * (`Incorrect API key provided: sk-abc12*********wxyz`). The prefix pattern
 * below CANNOT catch those: the star run interrupts it before its 6-character
 * minimum, so `sk-abc12` — real key material — survived into persisted logs.
 * Stripping the whole masked token first closes that, whatever the visible
 * prefix length. Must stay ahead of the other passes for the same reason.
 */
const MASKED_SECRET_RUN = /\S*[*•·…]{2,}\S*/g;

/**
 * Removes common credential forms from free-form messages.
 * Clipboard content is protected structurally by sensitive context-key redaction.
 */
export const redactLogMessage = (message: string): string =>
  message
    .replace(MASKED_SECRET_RUN, REDACTED)
    .replace(/\b(?:sk|or)-[a-z0-9][a-z0-9._-]{5,}\b/gi, REDACTED)
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(
      /\b(api[-_]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      `$1=${REDACTED}`,
    )
    .replace(/\b(openrouter_api_key)\s*[:=]\s*[^\s,;]+/gi, `$1=${REDACTED}`);

const isPrimitiveString = schemaGuard(z.string());

/**
 * Object-ness only — the same test `typeof value === "object"` made, so a
 * null-prototype or otherwise exotic record is still walked and redacted.
 */
const isContextRecord = schemaGuard(
  z.custom<LogContext>(
    (value) => NonArrayObjectSchema.safeParse(value).success,
  ),
);

const redactLogValue = (value: LogValue): LogValue => {
  if (isPrimitiveString(value)) {
    return redactLogMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item));
  }
  if (isContextRecord(value)) {
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
  /**
   * Severities to include. Omitted, empty, or "every level selected" all mean
   * the same thing: no level filtering (see `normalizeLogLevels`).
   */
  levels?: readonly LogLevel[];
  search?: string;
};

/** One page of newest-first log entries plus a cursor for older history. */
export type LogQueryResult = {
  entries: LogEntry[];
  /** Oldest timestamp in `entries`; pass as `beforeTimestamp` for the next page. */
  nextCursor: string | null;
  hasMore: boolean;
};

const LogLevelSchema = z.enum(LOG_LEVEL_ORDER);

/** Type guard for one severity token (used at every untrusted boundary). */
export const isLogLevel = schemaGuard(LogLevelSchema);

/**
 * Canonicalizes an untrusted level selection: keeps only known severities, in
 * severity order, and collapses a full selection to `[]`. Both `[]` and "all
 * four checked" mean "no level filter", so downstream code has exactly one
 * shape to reason about.
 */
export const normalizeLogLevels = <Selection>(value: Selection): LogLevel[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const selected = LOG_LEVEL_ORDER.filter((level) => value.includes(level));
  return selected.length === LOG_LEVEL_ORDER.length ? [] : selected;
};

/** Level gate shared by the disk query, the live IPC push, and the dashboard. */
export const logEntryMatchesLevels = (
  entry: LogEntry,
  levels: readonly LogLevel[],
): boolean => levels.length === 0 || levels.includes(entry.level);

const LogScalarSchema = z.union([
  z.null(),
  z.string(),
  AnyNumberSchema,
  z.boolean(),
]);

const isNonArrayObject = schemaGuard(NonArrayObjectSchema);

/** Own enumerable values only, as `Object.values` reads them. */
const LogContextSchema: z.ZodType<LogContext> = z.custom<LogContext>(
  (value) =>
    isNonArrayObject(value) &&
    Object.values(value).every(
      (item) => LogValueSchema.safeParse(item).success,
    ),
);

const LogValueSchema: z.ZodType<LogValue> = z.lazy(() =>
  z.union([LogScalarSchema, LogArraySchema, LogContextSchema]),
);

const LogArraySchema = everyItemSchema(LogValueSchema);

export const LogEntrySchema: z.ZodType<LogEntry> = z.object({
  id: z.string(),
  timestamp: z.string(),
  level: LogLevelSchema,
  scope: z.string(),
  message: z.string(),
  context: LogContextSchema.optional(),
});

/** Type guard for a persisted / IPC log entry. */
export const isLogEntry = schemaGuard(LogEntrySchema);

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
