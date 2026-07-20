import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";
import { filterLogs } from "./logsView";
import type { LogLevelFilter } from "./logsView";
import type { LogEntry, LogLevel } from "~/shared/logging";

const LEVELS: readonly LogLevelFilter[] = [
  "all",
  "debug",
  "info",
  "warn",
  "error",
];

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-primary",
  warn: "text-yellow-500",
  error: "text-destructive",
};

const isLogLevelFilter = (value: string): value is LogLevelFilter =>
  value === "all" ||
  value === "debug" ||
  value === "info" ||
  value === "warn" ||
  value === "error";

const mergeLogs = (
  fetched: readonly LogEntry[],
  current: readonly LogEntry[],
): LogEntry[] => {
  const entries = new Map<string, LogEntry>();
  for (const entry of [...fetched, ...current]) {
    entries.set(entry.id, entry);
  }
  return [...entries.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-500);
};

/** Searchable live view of redacted main-process logs. */
export const LogsPanel = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [status, setStatus] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const removeListener = window.electronAPI.onLogAppend((entry) => {
      setLogs((current) => [...current, entry].slice(-500));
    });

    void window.electronAPI
      .getRecentLogs(500)
      .then((entries) => {
        setLogs((current) => mergeLogs(entries, current));
      })
      .catch((error: Error) => {
        setStatus(`Failed to load logs: ${error.message}`);
      });

    return removeListener;
  }, []);

  const filteredLogs = useMemo(
    () => filterLogs(logs, level, search),
    [level, logs, search],
  );

  useEffect(() => {
    if (autoScroll) {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [autoScroll, filteredLogs.length]);

  const handleClear = async (): Promise<void> => {
    try {
      await window.electronAPI.clearLogs();
      setLogs([]);
      setStatus("Logs cleared");
    } catch (error) {
      setStatus(
        `Failed to clear logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleCopy = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.copyLogs();
      setStatus(`Copied ${result.count} log entries`);
    } catch (error) {
      setStatus(
        `Failed to copy logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleExport = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.exportLogs();
      if (result.success) {
        setStatus("Logs exported");
      } else if (!result.canceled) {
        setStatus(`Failed to export logs: ${result.error}`);
      }
    } catch (error) {
      setStatus(
        `Failed to export logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-48 flex-1">
          <span className="sr-only">Search logs</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search logs"
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
          />
        </label>

        <label>
          <span className="sr-only">Log level</span>
          <select
            value={level}
            onChange={(event) => {
              if (isLogLevelFilter(event.target.value)) {
                setLevel(event.target.value);
              }
            }}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
          >
            {LEVELS.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All levels" : option.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
          />
          Auto-scroll
        </label>

        <button
          type="button"
          onClick={() => void handleClear()}
          className="rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:opacity-90"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:opacity-90"
        >
          Copy all
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          Export .txt
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filteredLogs.length} of {logs.length} entries
        </span>
        <span role="status" aria-live="polite">
          {status}
        </span>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card font-mono text-xs"
        aria-label="Application logs"
      >
        {filteredLogs.length === 0 ? (
          <p className="p-4 text-center text-muted-foreground">
            No logs found.
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {filteredLogs.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[auto_auto_1fr] gap-2 p-2"
              >
                <time className="whitespace-nowrap text-muted-foreground">
                  {format(new Date(entry.timestamp), "yyyy-MM-dd HH:mm:ss XXX")}
                </time>
                <span
                  className={twJoin(
                    "font-semibold uppercase",
                    LEVEL_CLASS[entry.level],
                  )}
                >
                  {entry.level}
                </span>
                <span className="min-w-0 wrap-break-word text-foreground">
                  <span className="text-muted-foreground">[{entry.scope}]</span>{" "}
                  {entry.message}
                  {entry.context ? (
                    <span className="ml-2 text-muted-foreground">
                      {JSON.stringify(entry.context)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};
