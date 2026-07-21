import { app } from "electron";
import { logger } from "~/main/logging/logService";
import { createGitHubReleaseSource } from "./githubReleaseSource";
import { createUpdateService, type UpdateService } from "./updateService";

let updateService: UpdateService | null = null;

/** Initializes the singleton only after Electron's app lifecycle is ready. */
export const initializeUpdateService = (): UpdateService => {
  if (updateService !== null) {
    return updateService;
  }

  updateService = createUpdateService({
    releaseSource: createGitHubReleaseSource(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    getCurrentVersion: () => app.getVersion(),
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
