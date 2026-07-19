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
