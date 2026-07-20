/**
 * @file LogsPanel.tsx
 * @description Disk-backed logs dashboard: newest-first pages, infinite scroll,
 * and TanStack Virtual rows for large histories.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";
import {
  LOG_QUERY_PAGE_SIZE,
  logEntryMatchesSearch,
} from "~/shared/logging";
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

const ROW_ESTIMATE_PX = 44;
const LOAD_MORE_THRESHOLD = 12;
const SEARCH_DEBOUNCE_MS = 250;

const isLogLevelFilter = (value: string): value is LogLevelFilter =>
  value === "all" ||
  value === "debug" ||
  value === "info" ||
  value === "warn" ||
  value === "error";

const entryMatchesFilters = (
  entry: LogEntry,
  level: LogLevelFilter,
  search: string,
): boolean => {
  if (level !== "all" && entry.level !== level) {
    return false;
  }
  return logEntryMatchesSearch(entry, search);
};

const mergeNewestFirst = (
  existing: readonly LogEntry[],
  incoming: readonly LogEntry[],
): LogEntry[] => {
  const byId = new Map<string, LogEntry>();
  for (const entry of [...incoming, ...existing]) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp),
  );
};

/** Searchable live view of redacted main-process logs (persisted + live). */
export const LogsPanel = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [status, setStatus] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreLock = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadInitialPage = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setStatus("");
    try {
      const page = await window.electronAPI.queryLogs({
        limit: LOG_QUERY_PAGE_SIZE,
        level,
        search: debouncedSearch,
      });
      setLogs(page.entries);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      setLogs([]);
      setNextCursor(null);
      setHasMore(false);
      setStatus(
        `Failed to load logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, level]);

  const loadOlderPage = useCallback(async (): Promise<void> => {
    if (!hasMore || nextCursor === null || loadMoreLock.current) {
      return;
    }
    loadMoreLock.current = true;
    setIsLoadingMore(true);
    try {
      const page = await window.electronAPI.queryLogs({
        beforeTimestamp: nextCursor,
        limit: LOG_QUERY_PAGE_SIZE,
        level,
        search: debouncedSearch,
      });
      setLogs((current) => mergeNewestFirst(current, page.entries));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      setStatus(
        `Failed to load older logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoadingMore(false);
      loadMoreLock.current = false;
    }
  }, [debouncedSearch, hasMore, level, nextCursor]);

  useEffect(() => {
    void loadInitialPage();
  }, [loadInitialPage]);

  useEffect(() => {
    const removeListener = window.electronAPI.onLogAppend((entry) => {
      if (!entryMatchesFilters(entry, level, debouncedSearch)) {
        return;
      }
      setLogs((current) => mergeNewestFirst(current, [entry]));
    });
    return removeListener;
  }, [debouncedSearch, level]);

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 12,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem === undefined) {
      return;
    }
    if (lastItem.index >= logs.length - LOAD_MORE_THRESHOLD) {
      void loadOlderPage();
    }
  }, [loadOlderPage, logs.length, virtualItems]);

  const newestLogId = logs[0]?.id;

  useEffect(() => {
    if (autoScroll && newestLogId !== undefined) {
      listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [autoScroll, newestLogId]);

  const handleClear = async (): Promise<void> => {
    try {
      await window.electronAPI.clearLogs();
      setLogs([]);
      setNextCursor(null);
      setHasMore(false);
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

  const footerLabel = useMemo(() => {
    if (isLoading) {
      return "Loading…";
    }
    if (isLoadingMore) {
      return `Showing ${logs.length} · loading older…`;
    }
    if (hasMore) {
      return `Showing ${logs.length} · scroll for older`;
    }
    return `${logs.length} entries`;
  }, [hasMore, isLoading, isLoadingMore, logs.length]);

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
        <span>{footerLabel}</span>
        <span role="status" aria-live="polite">
          {status}
        </span>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card font-mono text-xs"
        aria-label="Application logs"
      >
        {logs.length === 0 && !isLoading ? (
          <p className="p-4 text-center text-muted-foreground">
            No logs found.
          </p>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const entry = logs[virtualRow.index];
              if (entry === undefined) {
                return null;
              }
              return (
                <div
                  key={entry.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full border-b border-border"
                  style={{
                    transform: `translateY(${String(virtualRow.start)}px)`,
                  }}
                >
                  <div className="grid grid-cols-[auto_auto_1fr] gap-2 p-2">
                    <time className="whitespace-nowrap text-muted-foreground">
                      {format(
                        new Date(entry.timestamp),
                        "yyyy-MM-dd HH:mm:ss XXX",
                      )}
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
                      <span className="text-muted-foreground">
                        [{entry.scope}]
                      </span>{" "}
                      {entry.message}
                      {entry.context ? (
                        <span className="ml-2 text-muted-foreground">
                          {JSON.stringify(entry.context)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
