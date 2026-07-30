import { ipcRenderer } from "electron";
import type { AskInputPayload, AskResultPayload } from "~/features/ask/shared/ask";

/**
 * Validates the ask-input payload crossing the preload boundary. Mirrors
 * `correctionResult.ts`'s `isCorrectionResultPayload` — narrow types are
 * checked field by field, never widened just because the shape is small.
 */
const isAskInputPayload = (value: unknown): value is AskInputPayload => {
  if (typeof value !== "object" || value === null) return false;
  if (!("presetId" in value) || typeof value.presetId !== "string") {
    return false;
  }
  if (!("context" in value) || typeof value.context !== "string") {
    return false;
  }
  return true;
};

/**
 * Validates the ask-result payload crossing the preload boundary.
 * `presetName` (mirroring `CorrectionResultPayload`) and `input` (the carried-in
 * selection) are optional but must be strings when present — the result window
 * renders both as `string`-typed text, so a non-string reaching it would crash
 * the render instead of being rejected here.
 */
const isAskResultPayload = (value: unknown): value is AskResultPayload => {
  if (typeof value !== "object" || value === null) return false;
  if (!("question" in value) || typeof value.question !== "string") {
    return false;
  }
  if (!("answer" in value) || typeof value.answer !== "string") {
    return false;
  }
  if (!("markdown" in value) || typeof value.markdown !== "boolean") {
    return false;
  }
  if ("presetName" in value && typeof value.presetName !== "string") {
    return false;
  }
  if ("input" in value && typeof value.input !== "string") {
    return false;
  }
  return true;
};

export const askFeature = {
  /**
   * Subscribes to ask-input payloads (the hotkey's presetId + carried-in
   * selection) from the main process. Call {@link signalAskInputReady} after
   * installing this listener so the first payload is not lost.
   */
  onAskInputData: (
    callback: (payload: AskInputPayload) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      if (isAskInputPayload(payload)) callback(payload);
    };
    ipcRenderer.on("ask-input-data", listener);
    return () => ipcRenderer.removeListener("ask-input-data", listener);
  },

  /**
   * Tells main the Ask input window has registered its payload listener so
   * the first ask-input-data event is not lost.
   */
  signalAskInputReady: (): void => {
    ipcRenderer.send("ask-input-ready");
  },

  /** Submits the typed question (already trimmed by the caller) to main. */
  submitAskInput: (question: string): void => {
    ipcRenderer.send("ask-input-submit", question);
  },

  /** Cancels the Ask input window without submitting a question. */
  cancelAskInput: (): void => {
    ipcRenderer.send("ask-input-cancel");
  },

  /**
   * Subscribes to ask-result payloads (the question + answer to render) from
   * the main process. Call {@link signalAskResultReady} after installing this
   * listener so the first payload is not lost.
   */
  onAskResultData: (
    callback: (payload: AskResultPayload) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      if (isAskResultPayload(payload)) callback(payload);
    };
    ipcRenderer.on("ask-result-data", listener);
    return () => ipcRenderer.removeListener("ask-result-data", listener);
  },

  /**
   * Tells main this Ask result window has registered its payload listener so
   * the first ask-result-data event is not lost.
   */
  signalAskResultReady: (): void => {
    ipcRenderer.send("ask-result-ready");
  },

  /** Closes this Ask result window. Main identifies which one via the sender. */
  closeAskResultWindow: (): void => {
    ipcRenderer.send("close-ask-result-window");
  },
};

export type AskFeature = typeof askFeature;
