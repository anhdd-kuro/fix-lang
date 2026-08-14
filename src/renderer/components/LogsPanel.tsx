/**
 * @file LogsPanel.tsx
 * @description Disk-backed logs dashboard: newest-first pages, infinite scroll,
 * and TanStack Virtual rows for large histories.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";
import { msg, type Message } from "~/features/i18n/shared/message";
import {
  isLogLevel,
  LOG_LEVEL_ORDER,
  LOG_QUERY_PAGE_SIZE,
  logEntryMatchesLevels,
  logEntryMatchesSearch,
} from "~/features/logs/shared/logging";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Input } from "./Input";
import { logRowKey, timeZoneLabel } from "./logsView";
import { MultiSelect } from "./MultiSelect";
import { useI18n } from "../i18n/useI18n";
import type { TranslationKey } from "~/features/i18n/shared/keys";
import type { LogEntry, LogLevel } from "~/features/logs/shared/logging";

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-primary",
  warn: "text-yellow-500",
  error: "text-destructive",
};

/**
 * Filter labels are UI chrome and get translated; the underlying `LogLevel`
 * values (used for querying/filtering) stay raw English tokens — level names
 * are machine data, not prose.
 */
const LEVEL_LABEL_KEYS: Record<LogLevel, TranslationKey> = {
  debug: "logs.panel.level.debug",
  info: "logs.panel.level.info",
  warn: "logs.panel.level.warn",
  error: "logs.panel.level.error",
};

const ROW_ESTIMATE_PX = 44;
const LOAD_MORE_THRESHOLD = 12;
const SEARCH_DEBOUNCE_MS = 250;

const entryMatchesFilters = (
  entry: LogEntry,
  levels: readonly LogLevel[],
  search: string,
): boolean =>
  logEntryMatchesLevels(entry, levels) &&
  logEntryMatchesSearch(entry, search);

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
  const { t, tm, dateFnsLocale } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Empty selection means "every level" — the same normalization the query
  // layer applies, so a full selection and no selection query identically.
  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  // Holds a locale-free descriptor (never rendered prose) so `loadInitialPage`/
  // `loadOlderPage` do not need `t` in their dependency arrays — see those
  // callbacks below. Resolved via `tm()` at render time instead.
  const [status, setStatus] = useState<Message | null>(null);
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

  // `t` is intentionally NOT a dependency: this fetches on mount and again
  // whenever `debouncedSearch`/`level` change, and closing over `t` would
  // force a re-fetch on every locale switch for no reason. That does NOT
  // mean the error banner is unreachable in the old language after a switch
  // though — `status` stores a locale-free descriptor (`Message`), resolved
  // via `tm()` at render, so a stale `queryLogs()` failure renders correctly
  // in whichever locale is active when the banner is shown, not whichever
  // was active when the request failed.
  const loadInitialPage = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setStatus(null);
    try {
      const page = await window.electronAPI.queryLogs({
        limit: LOG_QUERY_PAGE_SIZE,
        levels,
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
        msg("logs.panel.error.loadFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, levels]);

  // Same rationale as `loadInitialPage` above.
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
        levels,
        search: debouncedSearch,
      });
      setLogs((current) => mergeNewestFirst(current, page.entries));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      setStatus(
        msg("logs.panel.error.loadMoreFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsLoadingMore(false);
      loadMoreLock.current = false;
    }
  }, [debouncedSearch, hasMore, levels, nextCursor]);

  useEffect(() => {
    void loadInitialPage();
  }, [loadInitialPage]);

  useEffect(() => {
    const removeListener = window.electronAPI.onLogAppend((entry) => {
      if (!entryMatchesFilters(entry, levels, debouncedSearch)) {
        return;
      }
      setLogs((current) => mergeNewestFirst(current, [entry]));
    });
    return removeListener;
  }, [debouncedSearch, levels]);

  const getLogRowKey = useCallback(
    (index: number) => logRowKey(logs, index),
    [logs],
  );

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => listRef.current,
    getItemKey: getLogRowKey,
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
      setStatus(msg("logs.panel.status.cleared"));
    } catch (error) {
      setStatus(
        msg("logs.panel.error.clearFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const handleCopy = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.copyLogs();
      setStatus(msg("logs.panel.status.copied", { count: result.count }));
    } catch (error) {
      setStatus(
        msg("logs.panel.error.copyFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const handleExport = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.exportLogs();
      if (result.success) {
        setStatus(msg("logs.panel.status.exported"));
      } else if (!result.canceled) {
        setStatus(
          msg("logs.panel.error.exportFailed", { message: result.error }),
        );
      }
    } catch (error) {
      setStatus(
        msg("logs.panel.error.exportFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  // `t`/`locale` are in the dependency array on purpose (memoization trap):
  // this label is derived state, not a mount-once fetch, so a stale memo here
  // would leave the footer in the old language after a locale switch.
  const footerLabel = useMemo(() => {
    if (isLoading) {
      return t("common.loading");
    }
    if (isLoadingMore) {
      return t("logs.panel.footer.loadingMore", { count: logs.length });
    }
    if (hasMore) {
      return t("logs.panel.footer.moreAvailable", { count: logs.length });
    }
    return t("logs.panel.footer.count", { count: logs.length });
  }, [hasMore, isLoading, isLoadingMore, logs.length, t]);

  const levelOptions = useMemo(
    () =>
      LOG_LEVEL_ORDER.map((option) => ({
        value: option,
        label: t(LEVEL_LABEL_KEYS[option]),
      })),
    [t],
  );

  // Same memoization trap as `footerLabel`: derived prose, so `t` belongs in
  // the dependency array. "Nothing checked" and "everything checked" query
  // identically, so both read as "All levels" rather than one of them
  // rendering a four-item list that the trigger would truncate anyway.
  const levelTriggerLabel = useMemo(
    () =>
      levels.length === 0 || levels.length === LOG_LEVEL_ORDER.length
        ? t("logs.panel.level.all")
        : levels.map((option) => t(LEVEL_LABEL_KEYS[option])).join(", "),
    [levels, t],
  );

  // Row timestamps render without an offset; the zone is stated once here so
  // it is not repeated on every line. Resolved once — the app does not survive
  // a host timezone change without a restart anyway.
  const timezone = useMemo(
    () =>
      timeZoneLabel(
        new Date(),
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    [],
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-48 flex-1">
          <span className="sr-only">{t("logs.panel.search")}</span>
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("logs.panel.search")}
            className="w-full"
          />
        </label>

        <MultiSelect
          options={levelOptions}
          selected={levels}
          onChange={(values) => setLevels(values.filter(isLogLevel))}
          triggerLabel={levelTriggerLabel}
          ariaLabel={t("logs.panel.levelLabel")}
          className="w-44"
        />

        <Checkbox
          checked={autoScroll}
          onChange={setAutoScroll}
          label={t("logs.panel.autoScroll")}
          className="text-muted-foreground"
        />

        <Button
          variant="destructive"
          onClick={() => void handleClear()}
          className="rounded-md px-3 py-1.5 text-sm"
        >
          {t("logs.panel.clearButton")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleCopy()}
          className="rounded-md px-3 py-1.5 text-sm"
        >
          {t("logs.panel.copyAllButton")}
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleExport()}
          className="rounded-md px-3 py-1.5 text-sm"
        >
          {t("logs.panel.exportButton")}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {footerLabel}
          {" · "}
          {t("logs.panel.footer.timezone", { zone: timezone })}
        </span>
        <span role="status" aria-live="polite">
          {status ? tm(status) : ""}
        </span>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-card-control-border bg-card font-mono text-xs"
        aria-label={t("logs.panel.listAriaLabel")}
      >
        {logs.length === 0 && !isLoading ? (
          <p className="p-4 text-center text-muted-foreground">
            {t("logs.panel.empty")}
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
                  className="absolute top-0 left-0 w-full border-b border-card-control-border"
                  style={{
                    transform: `translateY(${String(virtualRow.start)}px)`,
                  }}
                >
                  <div className="grid grid-cols-[auto_auto_1fr] gap-2 p-2">
                    <time className="whitespace-nowrap text-muted-foreground">
                      {/* No offset here — the footer states the zone once. */}
                      {format(
                        new Date(entry.timestamp),
                        "yyyy-MM-dd HH:mm:ss",
                        { locale: dateFnsLocale },
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
                    <span className="min-w-0 break-words [overflow-wrap:anywhere] text-foreground">
                      <span className="text-muted-foreground">
                        [{entry.scope}]
                      </span>{" "}
                      {entry.message}
                      {entry.context ? (
                        <span className="ml-2 break-words [overflow-wrap:anywhere] text-muted-foreground">
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
