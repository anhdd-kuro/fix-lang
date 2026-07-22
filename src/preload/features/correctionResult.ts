import { ipcRenderer } from "electron";
import type { CorrectionResultPayload } from "~/shared/correctionResult";

/**
 * Validates the correction-result payload crossing the preload boundary.
 */
const isCorrectionResultPayload = (
  value: unknown,
): value is CorrectionResultPayload => {
  if (typeof value !== "object" || value === null) return false;
  if (!("title" in value) || !("text" in value)) return false;
  return typeof value.title === "string" && typeof value.text === "string";
};

export const correctionResultFeature = {
  /**
   * Subscribes to correction-result payloads from the main process.
   * Call {@link signalCorrectionResultReady} after installing this listener.
   */
  onCorrectionResultData: (
    callback: (payload: CorrectionResultPayload) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      if (isCorrectionResultPayload(payload)) callback(payload);
    };
    ipcRenderer.on("correction-result-data", listener);
    return () => ipcRenderer.removeListener("correction-result-data", listener);
  },

  /**
   * Tells main the renderer has registered its payload listener so the first
   * correction-result-data event is not lost.
   */
  signalCorrectionResultReady: (): void => {
    ipcRenderer.send("correction-result-ready");
  },

  closeCorrectionResultWindow: (): void => {
    ipcRenderer.send("close-correction-result-window");
  },
};

export type CorrectionResultFeature = typeof correctionResultFeature;
