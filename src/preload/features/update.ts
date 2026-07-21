import { ipcRenderer } from "electron";
import {
  isOpenUpdateReleaseResult,
  isUpdateState,
  type OpenUpdateReleaseResult,
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

/** Exposes the app-update state and explicit user actions to the renderer. */
export const updateFeature = {
  getUpdateState: (): Promise<UpdateState> => invokeUpdateAction("updates:get-state"),

  checkForUpdates: (): Promise<UpdateState> => invokeUpdateAction("updates:check"),

  downloadUpdate: (): Promise<UpdateState> => invokeUpdateAction("updates:download"),

  installUpdate: (): Promise<UpdateState> => invokeUpdateAction("updates:install"),

  openUpdateRelease: (): Promise<OpenUpdateReleaseResult> => invokeOpenRelease(),

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
