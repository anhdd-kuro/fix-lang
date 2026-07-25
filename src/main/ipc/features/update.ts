import { BrowserWindow, ipcMain, shell } from "electron";
import type { UpdateService } from "~/main/update";
import type { OpenUpdateReleaseResult, UpdateState } from "~/shared/update";

const RELEASES_URL = "https://github.com/anhdd-kuro/fix-lang/releases/latest";

const broadcastState = (state: UpdateState): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("updates:state", state);
    }
  }
};

/** Registers the narrow renderer-facing controls for app updates. */
export const registerUpdateHandlers = (service: UpdateService): void => {
  ipcMain.handle("updates:get-state", () => service.getState());
  ipcMain.handle("updates:check", async () => {
    await service.checkForUpdates();
    return service.getState();
  });
  ipcMain.handle("updates:open-release", async () => {
    try {
      await shell.openExternal(service.getReleaseUrl() ?? RELEASES_URL);
      return { success: true } satisfies OpenUpdateReleaseResult;
    } catch {
      return {
        success: false,
        error: "Could not open the releases page",
      } satisfies OpenUpdateReleaseResult;
    }
  });

  service.subscribe(broadcastState);
};
