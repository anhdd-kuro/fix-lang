import { autoUpdater } from "electron-updater";
import type { UpdateDriver } from "./updateService";

type EventableUpdater = {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

/** Adapts electron-updater's overloaded event API to the small service seam. */
export const createElectronUpdaterDriver = (): UpdateDriver => {
  const eventableUpdater = autoUpdater as unknown as EventableUpdater;

  return {
    get autoDownload() {
      return autoUpdater.autoDownload;
    },
    set autoDownload(value: boolean) {
      autoUpdater.autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return autoUpdater.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value: boolean) {
      autoUpdater.autoInstallOnAppQuit = value;
    },
    get allowPrerelease() {
      return autoUpdater.allowPrerelease;
    },
    set allowPrerelease(value: boolean) {
      autoUpdater.allowPrerelease = value;
    },
    get allowDowngrade() {
      return autoUpdater.allowDowngrade;
    },
    set allowDowngrade(value: boolean) {
      autoUpdater.allowDowngrade = value;
    },
    on: (event, listener) => eventableUpdater.on(event, listener),
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
};
