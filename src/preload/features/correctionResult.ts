import { ipcRenderer } from "electron";
import type { CorrectionResultPayload } from "~/shared/correctionResult";

const isCorrectionResultPayload = (
  value: unknown,
): value is CorrectionResultPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === "string" && typeof candidate.text === "string";
};

export const correctionResultFeature = {
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

  closeCorrectionResultWindow: (): void => {
    ipcRenderer.send("close-correction-result-window");
  },
};

export type CorrectionResultFeature = typeof correctionResultFeature;
