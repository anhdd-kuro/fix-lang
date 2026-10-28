import { ipcRenderer } from "electron";
import { z } from "zod";
import {
  NonArrayObjectSchema,
  schemaGuard,
} from "~/features/core/shared/schemaGuard";
import type { CorrectionResultPayload } from "~/features/correction/shared/correctionResult";

/** Any non-null object, arrays included — what `typeof value === "object"` admitted. */
const isObjectValue = schemaGuard(
  z.custom<object>(
    (value) =>
      Array.isArray(value) || NonArrayObjectSchema.safeParse(value).success,
  ),
);

const isText = schemaGuard(z.string());

/**
 * Validates the correction-result payload crossing the preload boundary.
 * `presetName` is optional (a correction delivered outside any preset
 * context omits it) but must be a string when present — never widen this to
 * accept arbitrary shapes just because the field is optional.
 */
const CorrectionResultPayloadSchema = z.custom<CorrectionResultPayload>(
  (value) => {
    if (!isObjectValue(value)) return false;
    if (!("text" in value) || !isText(value.text)) return false;
    if ("presetName" in value && !isText(value.presetName)) return false;
    return true;
  },
);

const isCorrectionResultPayload = schemaGuard(CorrectionResultPayloadSchema);

export const correctionResultFeature = {
  /**
   * Subscribes to correction-result payloads from the main process.
   * Call {@link signalCorrectionResultReady} after installing this listener.
   */
  onCorrectionResultData: (
    callback: (payload: CorrectionResultPayload) => void,
  ): (() => void) => {
    const listener: Parameters<typeof ipcRenderer.on>[1] = (
      _event,
      payload,
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

  /** Opens the result popup with bundled example copy for the user guide. */
  previewCorrectionResult: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("preview-correction-result"),
};

export type CorrectionResultFeature = typeof correctionResultFeature;
