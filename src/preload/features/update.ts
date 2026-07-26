import { ipcRenderer } from "electron";
import {
  isInstallUpdateResult,
  isOpenUpdateReleaseResult,
  isUpdateActionResult,
  isUpdateState,
  type InstallUpdateResult,
  type OpenUpdateReleaseResult,
  type UpdateActionResult,
  type UpdateState,
} from "~/shared/update";

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
};

export type UpdateFeature = typeof updateFeature;
