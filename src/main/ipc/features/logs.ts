import { writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { logService, logger } from "~/main/logging/logService";
import { LOG_QUERY_PAGE_SIZE } from "~/shared/logging";
import type { LogLevel, LogQueryRequest } from "~/shared/logging";

const MAX_RECENT_LOGS = 500;

const normalizeLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_RECENT_LOGS;
  }
  return Math.max(0, Math.min(MAX_RECENT_LOGS, Math.floor(value)));
};

const isLogLevelOrAll = (value: unknown): value is LogLevel | "all" =>
  value === "all" ||
  value === "debug" ||
  value === "info" ||
  value === "warn" ||
  value === "error";

const normalizeQueryRequest = (value: unknown): LogQueryRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { limit: LOG_QUERY_PAGE_SIZE };
  }
  const record = value as Record<string, unknown>;
  const request: LogQueryRequest = {
    limit:
      typeof record.limit === "number" && Number.isFinite(record.limit)
        ? Math.max(1, Math.min(500, Math.floor(record.limit)))
        : LOG_QUERY_PAGE_SIZE,
  };
  if (
    typeof record.beforeTimestamp === "string" &&
    record.beforeTimestamp.length > 0
  ) {
    request.beforeTimestamp = record.beforeTimestamp;
  }
  if (isLogLevelOrAll(record.level)) {
    request.level = record.level;
  }
  if (typeof record.search === "string") {
    request.search = record.search;
  }
  return request;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Registers validated renderer access to redacted structured logs. */
export const registerLogHandlers = (): void => {
  logService.enablePersistence(app.getPath("userData"));
  logger.info("logs", "Structured logging initialized");

  ipcMain.handle(
    "logs:get-recent",
    async (_event: Electron.IpcMainInvokeEvent, limit: unknown) =>
      logService.getRecent(normalizeLimit(limit)),
  );

  ipcMain.handle(
    "logs:query",
    async (_event: Electron.IpcMainInvokeEvent, request: unknown) =>
      logService.query(normalizeQueryRequest(request)),
  );

  ipcMain.handle("logs:clear", async () => {
    await logService.clear();
    return { success: true };
  });

  ipcMain.handle("logs:copy", async () => {
    const text = await logService.formatAll();
    clipboard.writeText(text);
    const count = text.length === 0 ? 0 : text.split("\n").length;
    return { success: true, count };
  });

  ipcMain.handle("logs:export", async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const result = await dialog.showSaveDialog({
      title: "Export FixLang Logs",
      defaultPath: path.join(
        app.getPath("documents"),
        `fixlang-logs-${timestamp}.txt`,
      ),
      filters: [{ name: "Text files", extensions: ["txt"] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    try {
      await writeFile(result.filePath, await logService.formatAll(), "utf8");
      return { success: true, canceled: false };
    } catch (error) {
      logger.error("logs.ipc", "Failed to export logs", {
        error: errorMessage(error),
      });
      return {
        success: false,
        canceled: false,
        error: errorMessage(error),
      };
    }
  });

  logService.subscribe((entry) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("logs:append", entry);
      }
    }
  });
};
