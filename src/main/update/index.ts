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

/**
 * Same detached-process pattern `homebrew.ts` uses for the ordinary upgrade
 * helper (`spawn("/bin/sh", ["-c", script], { detached: true, ... })`), but
 * that module exports no runner for it — only the pure `buildUpgradeScript`/
 * `buildChannelSwitchScript` text builders are public. Duplicated here rather
 * than widening `homebrew.ts`'s surface for a card that owns neither file.
 */
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

/**
 * The pure half of "bind the upgrader to the token that is ACTUALLY staged" —
 * see the call site's doc comment in {@link initializeUpdateService} for the
 * full story of why this must not collapse to `STABLE_CASK_TOKEN`
 * unconditionally. Exported so the choice itself is unit-testable without
 * standing up Electron's `app`/`dialog` singletons.
 */
export const chooseBoundCaskToken = (
  activeChannel: ActiveCaskChannel | null,
): CaskToken => (activeChannel === "beta" ? BETA_CASK_TOKEN : STABLE_CASK_TOKEN);

/**
 * The `detail` body of the switch confirm: the quit/download/reopen mechanics,
 * then the risk those mechanics hide.
 *
 * Both channels share ONE `userData`, and a beta can leave two DIFFERENT kinds
 * of damage there — kept distinct here because a previous version of this
 * comment merged them and invented a wipe vector that does not exist:
 *
 * 1. WIPE — the only path to one FOR THIS DATA, not the only store in the app
 *    built this way (eight others set the same flag over far smaller values):
 *    `apiStore` is constructed with
 *    `clearInvalidConfig: true` (`apiStore.ts`), and its own comment spells out
 *    the consequence — a single value failing schema validation "wipes the
 *    ENTIRE config — every profile, preset, and key reference" (which is why
 *    `guardStore.ts` exists as a separate store at all). A beta that writes a
 *    value this stable release's schema rejects lands exactly there.
 * 2. NOT a wipe: `configVersion` is `{ type: "number", default: 0 }`, so any
 *    number a beta writes passes validation, and the migration gate reads
 *    `configVersion >= 1` (`migrateStoredProfilesForModelRefs`). A beta that
 *    bumps it forward makes stable SKIP that migration and leaves profiles
 *    unmigrated — bad, but neither a validation failure nor a reset.
 *
 * Migrations run forward only, with no inverse, so neither is undone by going
 * back. Revert, the direction this feature calls safe, is where they land. It
 * is *no guarantee*, not *will always happen*: it takes the beta actually
 * writing such a value. The copy says that much and no more.
 *
 * Takes the translator rather than reaching for `mainT` so the copy is
 * testable in both shipped languages without standing up Electron.
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
  // The same rule as launch checks: only a real installed app can be
  // upgraded in place by the cask. Shared by the upgrader below AND by
  // `brewBinary` here — resolving `findBrewBinary` for a dev/unpacked build
  // would trust whatever happens to be on the MAINTAINER's machine, not this
  // running instance, which is exactly the hazard `isInstalledApp` already
  // guards for `createHomebrewUpgrader`.
  const isInstalledApp =
    app.isPackaged &&
    shouldCheckForUpdatesOnLaunch(app.getPath("exe"), app.getPath("home"));
  const brewBinary = isInstalledApp ? findBrewBinary() : null;

  /**
   * Wires `detectActiveCaskChannel` (a pure Caskroom probe) with the
   * `brewBinary` it needs but never exposes — the composition `homebrew.ts`'s
   * own doc comment on `detectActiveCaskChannel` calls out as this module's
   * job. `null` when brew cannot be resolved at all; the service already
   * treats that as "undetectable" rather than "stable", per
   * `UpdateServiceOptions.detectActiveCaskChannel`'s doc comment.
   */
  const probeActiveCaskChannel = (): ActiveCaskChannel | null =>
    brewBinary === null ? null : detectActiveCaskChannel(brewBinary);

  /**
   * Starts the detached channel-switch helper. Not a `HomebrewUpgrader`
   * method — see `UpdateServiceOptions.startChannelSwitch`'s doc comment for
   * why the (current, target) token pair is decided per call instead.
   */
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
   * The upgrader is bound to the token that is ACTUALLY staged, not to the
   * stable default.
   *
   * `createHomebrewUpgrader`'s `canInstall` is a probe of the BOUND token's
   * Caskroom, and `getInstallableVersion`/`downloadUpdate` both gate on it
   * regardless of the per-call token they are handed. A genuine beta install
   * has no `Caskroom/fixlang` entry, so a stable-bound upgrader reported
   * `canInstall: false` there — and `revertToStable`, whose whole population
   * is beta users, got `null` from its stable probe (resolved, never thrown,
   * so nothing was even logged) and a `downloadUpdate` that threw. `canSwitch`
   * reads the Caskroom rather than that flag, so the Revert button was live
   * and failed every single time.
   *
   * Read once at startup: the only way the active channel changes is a switch
   * or a revert, and both quit the app.
   */
  const boundCaskToken: CaskToken = chooseBoundCaskToken(probeActiveCaskChannel());

  // One dialog at a time, same discipline as `secretGuardDialog.ts`'s
  // `confirmSecretSend`: a reentrant call while one is already on screen
  // fails CLOSED (refuses) rather than stacking a second modal.
  let prereleaseConfirmInFlight = false;

  /**
   * The ONLY confirm this feature ever shows, and the ONLY place a switch to
   * the pre-release channel can be approved — the service itself never
   * fabricates consent. Uses the AWAITED `dialog.showMessageBox`; the sync
   * form has frozen main behind stacked modals in this codebase before (see
   * `secretGuardDialog.ts`'s file doc).
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
