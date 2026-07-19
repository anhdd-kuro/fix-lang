import { ipcRenderer } from "electron";
import type {
  LogContext,
  LogEntry,
  LogLevel,
  LogValue,
} from "~/shared/logging";

export type ExportLogsResult =
  | { success: true; canceled: false }
  | { success: false; canceled: true }
  | { success: false; canceled: false; error: string };

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

const isLogLevel = (value: unknown): value is LogLevel =>
  value === "debug" ||
  value === "info" ||
  value === "warn" ||
  value === "error";

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

const isLogEntry = (value: unknown): value is LogEntry =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.timestamp === "string" &&
  isLogLevel(value.level) &&
  LOG_LEVELS.has(value.level) &&
  typeof value.scope === "string" &&
  typeof value.message === "string" &&
  (value.context === undefined || isLogContext(value.context));

const normalizeLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.min(500, Math.floor(limit))) : 500;

const createLogsFeature = () => ({
  getRecentLogs: async (limit = 500): Promise<LogEntry[]> => {
    const result: unknown = await ipcRenderer.invoke(
      "logs:get-recent",
      normalizeLimit(limit),
    );
    return Array.isArray(result) ? result.filter(isLogEntry) : [];
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
