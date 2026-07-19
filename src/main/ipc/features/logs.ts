import { writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { logService, logger } from "~/main/logging/logService";

const MAX_RECENT_LOGS = 500;

const normalizeLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_RECENT_LOGS;
  }
  return Math.max(0, Math.min(MAX_RECENT_LOGS, Math.floor(value)));
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

  ipcMain.handle("logs:clear", async () => {
    await logService.clear();
    return { success: true };
  });

  ipcMain.handle("logs:copy", async () => {
    const text = logService.formatRecent();
    clipboard.writeText(text);
    return { success: true, count: logService.getRecent().length };
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
      await writeFile(result.filePath, logService.formatRecent(), "utf8");
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
