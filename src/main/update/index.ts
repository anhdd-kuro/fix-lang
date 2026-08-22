import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { app, dialog } from "electron";
import { mainT } from "~/main/i18n";
import { logger } from "~/main/logging/logService";
import { createGitHubReleaseSource } from "./githubReleaseSource";
import {
  BETA_CASK_TOKEN,
  buildChannelSwitchScript,
  createHomebrewUpgrader,
  detectActiveCaskChannel,
  findBrewBinary,
  STABLE_CASK_TOKEN,
  type ActiveCaskChannel,
  type CaskToken,
} from "./homebrew";
import { appBundlePath, shouldCheckForUpdatesOnLaunch } from "./installationPath";
import { createPendingInstallStore } from "./pendingInstall";
import { createUpdateService, type UpdateService } from "./updateService";
import type { TKey } from "~/features/i18n/shared/translate";

/** Gives the renderer time to render the installing state before the quit. */
const QUIT_FOR_UPGRADE_DELAY_MS = 600;

/** Duplicates `homebrew.ts`'s detached spawn; it exports only script builders. */
const startDetachedHelper = (script: string, logFilePath: string): void => {
  mkdirSync(path.dirname(logFilePath), { recursive: true });
  const logFd = openSync(logFilePath, "a");
  try {
    const child = spawn("/bin/sh", ["-c", script], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    // Detach fully: the helper must outlive the app it is replacing.
    child.unref();
  } finally {
    // The child keeps its own duplicated descriptor.
    closeSync(logFd);
  }
};

let updateService: UpdateService | null = null;

/** Exported so the binding choice is testable without Electron's singletons. */
export const chooseBoundCaskToken = (
  activeChannel: ActiveCaskChannel | null,
): CaskToken => (activeChannel === "beta" ? BETA_CASK_TOKEN : STABLE_CASK_TOKEN);

/**
 * The `detail` body of the switch confirm: the quit/download/reopen mechanics,
 * then the compatibility risk they hide — both channels share one `userData`,
 * and nothing guarantees a stable build can read what a beta wrote. Do not
 * trim that second half. Takes the translator rather than reaching for `mainT`
 * so the copy is testable in both shipped languages without Electron.
 */
export const buildPrereleaseConfirmDetail = (
  translate: (key: TKey) => string,
): string =>
  `${translate("settings.updates.prerelease.confirm.detail")}\n\n${translate(
    "settings.updates.prerelease.confirm.configWarning",
  )}`;

/** Initializes the singleton only after Electron's app lifecycle is ready. */
export const initializeUpdateService = (): UpdateService => {
  if (updateService !== null) {
    return updateService;
  }

  const userDataPath = app.getPath("userData");
  const runningAppPath = appBundlePath(app.getPath("exe"));
  // Only a real installed app can be upgraded in place by the cask, and
  // resolving brew for a dev/unpacked build would trust whatever is on the
  // MAINTAINER's machine rather than this running instance.
  const isInstalledApp =
    app.isPackaged &&
    shouldCheckForUpdatesOnLaunch(app.getPath("exe"), app.getPath("home"));
  const brewBinary = isInstalledApp ? findBrewBinary() : null;

  /** `null` when brew is unresolvable; the service reads that as "undetectable". */
  const probeActiveCaskChannel = (): ActiveCaskChannel | null =>
    brewBinary === null ? null : detectActiveCaskChannel(brewBinary);

  /** The (current, target) token pair is decided per call, not per upgrader. */
  const startPrereleaseChannelSwitch = (
    currentToken: CaskToken,
    targetToken: CaskToken,
    targetAppPath: string | null,
  ): void => {
    if (brewBinary === null) {
      throw new Error("FixLang was not installed with the Homebrew cask");
    }
    startDetachedHelper(
      buildChannelSwitchScript(brewBinary, currentToken, targetToken, targetAppPath),
      path.join(userDataPath, "logs", "homebrew-channel-switch.log"),
    );
  };

  /**
   * Bound to the token actually staged, not to the stable default:
   * `canInstall` and everything gated on it probe the BOUND token's Caskroom,
   * so a stable-bound upgrader answers `false` for a genuine beta install and
   * every revert fails. Read once at startup — the active channel only changes
   * through a switch or a revert, and both quit the app.
   */
  const boundCaskToken: CaskToken = chooseBoundCaskToken(probeActiveCaskChannel());

  // One dialog at a time: a reentrant call while one is on screen fails CLOSED.
  let prereleaseConfirmInFlight = false;

  /**
   * The only place a switch to the pre-release channel can be approved. The
   * AWAITED `dialog.showMessageBox`, because the sync form has frozen main
   * behind stacked modals in this codebase before.
   */
  const confirmPrereleaseSwitch = async (targetVersion: string): Promise<boolean> => {
    if (prereleaseConfirmInFlight) return false;
    prereleaseConfirmInFlight = true;
    try {
      const CANCEL_INDEX = 0;
      const SWITCH_INDEX = 1;
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: [
          mainT("settings.updates.prerelease.confirm.cancel"),
          mainT("settings.updates.prerelease.confirm.switch"),
        ],
        defaultId: CANCEL_INDEX,
        cancelId: CANCEL_INDEX,
        title: mainT("settings.updates.prerelease.confirm.title"),
        message: mainT("settings.updates.prerelease.confirm.message", {
          targetVersion,
        }),
        detail: buildPrereleaseConfirmDetail(mainT),
      });
      return response === SWITCH_INDEX;
    } catch {
      // A dialog that failed to open was never answered, so it is not consent.
      return false;
    } finally {
      prereleaseConfirmInFlight = false;
    }
  };

  updateService = createUpdateService({
    releaseSource: createGitHubReleaseSource(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    getCurrentVersion: () => app.getVersion(),
    upgrader: createHomebrewUpgrader({
      isInstalledApp,
      logFilePath: path.join(userDataPath, "logs", "homebrew-update.log"),
      caskToken: boundCaskToken,
    }),
    pendingInstall: createPendingInstallStore(
      path.join(userDataPath, "pending-update.json"),
    ),
    appPath: runningAppPath,
    detectActiveCaskChannel: probeActiveCaskChannel,
    confirmPrereleaseSwitch,
    startChannelSwitch: startPrereleaseChannelSwitch,
    quitApp: () => {
      setTimeout(() => {
        app.quit();
      }, QUIT_FOR_UPGRADE_DELAY_MS);
    },
    // A target path means this process is a DIFFERENT copy of FixLang, so
    // re-exec would relaunch that same wrong copy. `app.exit` rather than
    // `quit`: nothing may veto this.
    relaunchApp: (targetPath) => {
      // If the recorded bundle is gone, re-exec is the safer miss.
      if (
        targetPath !== null &&
        targetPath !== runningAppPath &&
        existsSync(targetPath)
      ) {
        const opener = spawn("/usr/bin/open", ["-a", targetPath], {
          detached: true,
          stdio: "ignore",
        });
        // This process is about to exit; an unhandled 'error' would throw on
        // the way out.
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
