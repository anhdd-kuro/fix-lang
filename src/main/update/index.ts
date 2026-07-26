import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { logger } from "~/main/logging/logService";
import { createGitHubReleaseSource } from "./githubReleaseSource";
import { createHomebrewUpgrader } from "./homebrew";
import { appBundlePath, shouldCheckForUpdatesOnLaunch } from "./installationPath";
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
  const runningAppPath = appBundlePath(app.getPath("exe"));

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
    appPath: runningAppPath,
    quitApp: () => {
      setTimeout(() => {
        app.quit();
      }, QUIT_FOR_UPGRADE_DELAY_MS);
    },
    // Normally `execPath` is the bundle Homebrew already replaced, so re-exec
    // starts the new version. When a target path is given this process is a
    // *different* copy of FixLang, and re-exec would relaunch that same wrong
    // copy — so open the upgraded bundle by path. Argument array, no shell.
    // `app.exit` rather than `quit`: nothing may veto this.
    relaunchApp: (targetPath) => {
      // `existsSync` before quitting: if the recorded bundle is gone, opening
      // it leaves the user with no app at all, so re-exec is the safer miss.
      if (
        targetPath !== null &&
        targetPath !== runningAppPath &&
        existsSync(targetPath)
      ) {
        const opener = spawn("/usr/bin/open", ["-a", targetPath], {
          detached: true,
          stdio: "ignore",
        });
        // This process is about to exit; an unhandled 'error' event here would
        // throw on the way out instead of just failing to reopen.
        opener.on("error", () => undefined);
        opener.unref();
      } else {
        app.relaunch();
      }
      app.exit(0);
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
