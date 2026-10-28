import { writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { z } from "zod";
import {
  LOG_QUERY_PAGE_SIZE,
  normalizeLogLevels,
} from "~/features/logs/shared/logging";
import { mainT } from "~/main/i18n";
import { logService, logger } from "~/main/logging/logService";
import type { LogQueryRequest } from "~/features/logs/shared/logging";

const MAX_RECENT_LOGS = 500;

// `z.number()` admits finite numbers only, so NaN and ±Infinity take the
// fallback exactly as the old `Number.isFinite` gate sent them there.
const RecentLogsLimitSchema = z
  .number()
  .transform((limit) =>
    Math.max(0, Math.min(MAX_RECENT_LOGS, Math.floor(limit))),
  )
  .catch(MAX_RECENT_LOGS);

/**
 * Each field degrades on its own: a bad one is dropped (or defaulted) without
 * costing the others. Only a payload that is not an object at all fails as a
 * whole.
 */
const LogQueryFieldsSchema = z.object({
  limit: z
    .number()
    .transform((limit) => Math.max(1, Math.min(500, Math.floor(limit))))
    .catch(LOG_QUERY_PAGE_SIZE),
  beforeTimestamp: z.string().min(1).optional().catch(undefined),
  levels: z.unknown().optional().transform(normalizeLogLevels),
  search: z.string().optional().catch(undefined),
});

const LogQueryRequestSchema = LogQueryFieldsSchema.transform(
  (fields): LogQueryRequest => {
    const request: LogQueryRequest = { limit: fields.limit };
    if (fields.beforeTimestamp !== undefined) {
      request.beforeTimestamp = fields.beforeTimestamp;
    }
    if (fields.levels.length > 0) {
      request.levels = fields.levels;
    }
    if (fields.search !== undefined) {
      request.search = fields.search;
    }
    return request;
  },
).catch(() => ({ limit: LOG_QUERY_PAGE_SIZE }));

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Registers validated renderer access to redacted structured logs. */
export const registerLogHandlers = (): void => {
  logService.enablePersistence(app.getPath("userData"));
  logger.info("logs", "Structured logging initialized");

  ipcMain.handle(
    "logs:get-recent",
    async (_event: Electron.IpcMainInvokeEvent, limit) =>
      logService.getRecent(RecentLogsLimitSchema.parse(limit)),
  );

  ipcMain.handle(
    "logs:query",
    async (_event: Electron.IpcMainInvokeEvent, request) =>
      logService.query(LogQueryRequestSchema.parse(request)),
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
      title: mainT("logs.export.dialogTitle"),
      defaultPath: path.join(
        app.getPath("documents"),
        `fixlang-logs-${timestamp}.txt`,
      ),
      filters: [{ name: mainT("logs.export.filterName"), extensions: ["txt"] }],
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
