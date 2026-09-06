import { ipcRenderer } from "electron";
import {
  isPrereleaseState,
  type PrereleaseState,
} from "~/features/update/shared/prerelease";
import {
  isInstallUpdateResult,
  isOpenUpdateReleaseResult,
  isUpdateActionResult,
  isUpdateState,
  type InstallUpdateResult,
  type OpenUpdateReleaseResult,
  type UpdateActionResult,
  type UpdateState,
} from "~/features/update/shared/update";

const invokeUpdateAction = async (channel: string): Promise<UpdateState> => {
  const state: unknown = await ipcRenderer.invoke(channel);
  if (!isUpdateState(state)) {
    throw new Error("Received an invalid update state");
  }
  return state;
};

const invokeOpenRelease = async (): Promise<OpenUpdateReleaseResult> => {
  const result: unknown = await ipcRenderer.invoke("updates:open-release");
  if (!isOpenUpdateReleaseResult(result)) {
    throw new Error("Received an invalid open-release result");
  }
  return result;
};

const invokeInstall = async (): Promise<InstallUpdateResult> => {
  const result: unknown = await ipcRenderer.invoke("updates:install");
  if (!isInstallUpdateResult(result)) {
    throw new Error("Received an invalid install result");
  }
  return result;
};

const invokeRestart = async (): Promise<UpdateActionResult> => {
  const result: unknown = await ipcRenderer.invoke("updates:restart");
  if (!isUpdateActionResult(result)) {
    throw new Error("Received an invalid restart result");
  }
  return result;
};

const invokePrereleaseState = async (
  channel: string,
): Promise<PrereleaseState> => {
  const state: unknown = await ipcRenderer.invoke(channel);
  if (!isPrereleaseState(state)) {
    throw new Error("Received an invalid pre-release state");
  }
  return state;
};

const invokePrereleaseAction = async (
  channel: string,
): Promise<UpdateActionResult> => {
  const result: unknown = await ipcRenderer.invoke(channel);
  if (!isUpdateActionResult(result)) {
    throw new Error("Received an invalid pre-release action result");
  }
  return result;
};

/** Exposes the app-update state and explicit user actions to the renderer. */
export const updateFeature = {
  getUpdateState: (): Promise<UpdateState> => invokeUpdateAction("updates:get-state"),

  checkForUpdates: (): Promise<UpdateState> => invokeUpdateAction("updates:check"),

  openUpdateRelease: (): Promise<OpenUpdateReleaseResult> => invokeOpenRelease(),

  /** Asks main to run `brew upgrade --cask fixlang` and relaunch FixLang. */
  installUpdate: (): Promise<InstallUpdateResult> => invokeInstall(),

  /** Re-executes the already-upgraded bundle so the new version runs. */
  restartForUpdate: (): Promise<UpdateActionResult> => invokeRestart(),

  onUpdateStateChanged: (
    callback: (state: UpdateState) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (isUpdateState(state)) {
        callback(state);
      }
    };
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },

  /**
   * Broadcast on its own channel (`updates:prerelease-state`), never on
   * `updates:state` — the tray subscribes only to the stable `UpdateState`
   * and has no use for pre-release fields.
   */
  getPrereleaseState: (): Promise<PrereleaseState> =>
    invokePrereleaseState("updates:prerelease:get-state"),

  checkForPrerelease: (): Promise<PrereleaseState> =>
    invokePrereleaseState("updates:prerelease:check"),

  /** Asks main to confirm, then switch the running install to the offered beta. */
  switchToPrerelease: (): Promise<UpdateActionResult> =>
    invokePrereleaseAction("updates:prerelease:switch"),

  /** Asks main to revert the running install back to the latest stable — no confirm. */
  revertToStable: (): Promise<UpdateActionResult> =>
    invokePrereleaseAction("updates:prerelease:revert"),

  onPrereleaseStateChanged: (
    callback: (state: PrereleaseState) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (isPrereleaseState(state)) {
        callback(state);
      }
    };
    ipcRenderer.on("updates:prerelease-state", listener);
    return () => ipcRenderer.removeListener("updates:prerelease-state", listener);
  },
};

export type UpdateFeature = typeof updateFeature;
