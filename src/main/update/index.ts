import path from "node:path";
import { app } from "electron";
import { logger } from "~/main/logging/logService";
import { createGitHubReleaseSource } from "./githubReleaseSource";
import { createHomebrewUpgrader } from "./homebrew";
import { shouldCheckForUpdatesOnLaunch } from "./installationPath";
import { createPendingInstallStore } from "./pendingInstall";
import { createUpdateService, type UpdateService } from "./updateService";

/** Gives the renderer time to render the installing state before the quit. */
const QUIT_FOR_UPGRADE_DELAY_MS = 600;

let updateService: UpdateService | null = null;

/** Initializes the singleton only after Electron's app lifecycle is ready. */
export const initializeUpdateService = (): UpdateService => {
  if (updateService !== null) {
    return updateService;
  }

  const userDataPath = app.getPath("userData");

  updateService = createUpdateService({
    releaseSource: createGitHubReleaseSource(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    getCurrentVersion: () => app.getVersion(),
    upgrader: createHomebrewUpgrader({
      // The same rule as launch checks: only a real installed app can be
      // upgraded in place by the cask.
      isInstalledApp:
        app.isPackaged &&
        shouldCheckForUpdatesOnLaunch(app.getPath("exe"), app.getPath("home")),
      logFilePath: path.join(userDataPath, "logs", "homebrew-update.log"),
    }),
    pendingInstall: createPendingInstallStore(
      path.join(userDataPath, "pending-update.json"),
    ),
    quitApp: () => {
      setTimeout(() => {
        app.quit();
      }, QUIT_FOR_UPGRADE_DELAY_MS);
    },
    onLog: (level, message) => logger[level]("updates", message),
  });
  return updateService;
};

export const getUpdateService = (): UpdateService => {
  if (updateService === null) {
    throw new Error("Update service has not been initialized");
  }
  return updateService;
};

export type { UpdateService } from "./updateService";
