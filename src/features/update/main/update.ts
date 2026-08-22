import { BrowserWindow, ipcMain, shell } from "electron";
import { msg } from "~/features/i18n/shared/message";
import type { PrereleaseState } from "~/features/update/shared/prerelease";
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
  registerPrereleaseHandlers(service);
};

/**
 * The pre-release half of `UpdateService`, named separately so the pre-release
 * registrar below states exactly what it touches. `UpdateService`
 * (`src/main/update/updateService.ts`) declares every member of this type, so
 * the service already passed to `registerUpdateHandlers` satisfies it — there
 * is no second service to construct and no second call site to remember.
 */
export type PrereleaseUpdateService = {
  getPrereleaseState(): PrereleaseState;
  checkForPrerelease(): Promise<PrereleaseState>;
  switchToPrerelease(): Promise<UpdateActionResult>;
  revertToStable(): Promise<UpdateActionResult>;
  subscribeToPrereleaseState(
    listener: (state: PrereleaseState) => void,
  ): () => void;
};

const broadcastPrereleaseState = (state: PrereleaseState): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("updates:prerelease-state", state);
    }
  }
};

/**
 * Registers the pre-release (beta channel) IPC surface on its own channel set,
 * broadcasting on `updates:prerelease-state` rather than `updates:state` — the
 * tray only ever calls `installUpdate`/`checkForUpdates` against the stable
 * `UpdateState` and never has to subscribe to fields it doesn't use.
 *
 * Deliberately NOT exported and NOT a second entry point for `src/main`: as an
 * exported registrar it had zero call sites, so every one of these channels was
 * unregistered at runtime and Settings -> Updates rejected on mount with
 * "No handler registered for 'updates:prerelease:get-state'". Nothing caught
 * it — the preload suite mocks `ipcRenderer.invoke`, which resolves whether or
 * not a handler exists. Registering from inside `registerUpdateHandlers` means
 * the separation is in the channel names, where it matters, rather than in a
 * second call site somebody has to remember to make.
 */
const registerPrereleaseHandlers = (
  service: PrereleaseUpdateService,
): void => {
  ipcMain.handle("updates:prerelease:get-state", () =>
    service.getPrereleaseState(),
  );
  ipcMain.handle("updates:prerelease:check", () => service.checkForPrerelease());
  // Input-free like `updates:install`: the offered version and target
  // channel are both decided in main, never by the renderer.
  ipcMain.handle("updates:prerelease:switch", () =>
    service.switchToPrerelease(),
  );
  // Also input-free — reverting always targets the latest stable release,
  // decided in main, and needs no confirm.
  ipcMain.handle("updates:prerelease:revert", () => service.revertToStable());

  service.subscribeToPrereleaseState(broadcastPrereleaseState);
};
