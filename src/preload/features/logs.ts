import { ipcRenderer } from "electron";
import {
  isLogEntry,
  LOG_QUERY_PAGE_SIZE,
} from "~/shared/logging";
import type {
  LogEntry,
  LogQueryRequest,
  LogQueryResult,
} from "~/shared/logging";

export type ExportLogsResult =
  | { success: true; canceled: false }
  | { success: false; canceled: true }
  | { success: false; canceled: false; error: string };

const normalizeLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.min(500, Math.floor(limit))) : 500;

const isLogQueryResult = (value: unknown): value is LogQueryResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.entries) &&
    record.entries.every((entry) => isLogEntry(entry)) &&
    (record.nextCursor === null || typeof record.nextCursor === "string") &&
    typeof record.hasMore === "boolean"
  );
};

const createLogsFeature = () => ({
  getRecentLogs: async (limit = 500): Promise<LogEntry[]> => {
    const result: unknown = await ipcRenderer.invoke(
      "logs:get-recent",
      normalizeLimit(limit),
    );
    return Array.isArray(result) ? result.filter(isLogEntry) : [];
  },
  queryLogs: async (
    request: LogQueryRequest = {},
  ): Promise<LogQueryResult> => {
    const payload: LogQueryRequest = {
      limit: request.limit ?? LOG_QUERY_PAGE_SIZE,
      ...(request.beforeTimestamp
        ? { beforeTimestamp: request.beforeTimestamp }
        : {}),
      ...(request.level ? { level: request.level } : {}),
      ...(request.search !== undefined ? { search: request.search } : {}),
    };
    const result: unknown = await ipcRenderer.invoke("logs:query", payload);
    if (isLogQueryResult(result)) {
      return result;
    }
    return { entries: [], nextCursor: null, hasMore: false };
  },
  clearLogs: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("logs:clear"),
  copyLogs: (): Promise<{ success: boolean; count: number }> =>
    ipcRenderer.invoke("logs:copy"),
  exportLogs: (): Promise<ExportLogsResult> =>
    ipcRenderer.invoke("logs:export"),
  onLogAppend: (callback: (entry: LogEntry) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ): void => {
      if (isLogEntry(payload)) {
        callback(payload);
      }
    };
    ipcRenderer.on("logs:append", listener);
    return () => ipcRenderer.removeListener("logs:append", listener);
  },
});

export const logsFeature = createLogsFeature();
export type LogsFeature = ReturnType<typeof createLogsFeature>;
