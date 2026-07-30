import { BrowserWindow, ipcMain, shell } from "electron";
import { msg } from "~/features/i18n/shared/message";
import type {
  InstallUpdateResult,
  OpenUpdateReleaseResult,
  UpdateActionResult,
  UpdateState,
} from "~/features/update/shared/update";
import type { UpdateService } from "~/main/update";

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
  // Takes no renderer input: the target release and the shell command are both
  // decided in main, so nothing crossing the bridge can influence what runs.
  ipcMain.handle(
    "updates:install",
    (): Promise<InstallUpdateResult> => service.installUpdate(),
  );
  // Also input-free, and the service refuses unless it is already in
  // `restart-required` — a renderer message cannot restart the app at will.
  ipcMain.handle(
    "updates:restart",
    (): UpdateActionResult => service.restartForUpdate(),
  );
  ipcMain.handle("updates:open-release", async () => {
    try {
      await shell.openExternal(service.getReleaseUrl() ?? RELEASES_URL);
      return { success: true } satisfies OpenUpdateReleaseResult;
    } catch {
      return {
        success: false,
        error: msg("settings.updates.openReleaseFailed"),
      } satisfies OpenUpdateReleaseResult;
    }
  });

  service.subscribe(broadcastState);
};
