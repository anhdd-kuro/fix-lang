import { ipcRenderer } from "electron";
import { z } from "zod";
import type {
  AskInputPayload,
  AskResultPayload,
} from "~/features/ask/shared/ask";

/** `ipcRenderer.on`'s listener; Electron types the payload it hands over `any`. */
type IpcRendererListener = Parameters<typeof ipcRenderer.on>[1];

/**
 * An object schema that, like `typeof value === "object" && value !== null`,
 * also admits an ARRAY carrying the named fields, read through the array's
 * own enumerable keys. Unknown keys are kept, as the guard passed the payload
 * it was handed through to the window.
 */
const objectLike = <Fields extends Parameters<typeof z.looseObject>[0]>(
  fields: Fields,
) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? { ...value } : value),
    z.looseObject(fields),
  );

/**
 * The ask-input payload crossing the preload boundary. Narrow types are
 * checked field by field, never widened just because the shape is small.
 *
 * Optional keys are EXACT-optional: absent is fine, present-but-`undefined` is
 * not, because the window renders each as `string`-typed text.
 *
 * `contextSource` is checked against the exact two members rather than
 * `string`: the window branches its label on this, and an unknown value would
 * fall through to the "this is your selection" wording for text that is not.
 * The two transparency strings (`systemPrompt`, `contextDirectives`) are
 * optional — a payload carrying neither is valid and the row simply shows
 * nothing.
 */
const AskInputPayloadSchema = objectLike({
  presetId: z.string(),
  context: z.string(),
  contextSource: z.enum(["selection", "clipboard"]).exactOptional(),
  systemPrompt: z.string().exactOptional(),
  contextDirectives: z.string().exactOptional(),
});

/**
 * The ask-result payload crossing the preload boundary. `presetName`
 * (mirroring `CorrectionResultPayload`) and `input` (the carried-in selection)
 * are optional but must be strings when present — the result window renders
 * both as `string`-typed text, so a non-string reaching it would crash the
 * render instead of being rejected here.
 */
const AskResultPayloadSchema = objectLike({
  question: z.string(),
  answer: z.string(),
  markdown: z.boolean(),
  presetName: z.string().exactOptional(),
  input: z.string().exactOptional(),
});

export const askFeature = {
  /**
   * Subscribes to ask-input payloads (the hotkey's presetId + carried-in
   * selection) from the main process. Call {@link signalAskInputReady} after
   * installing this listener so the first payload is not lost.
   */
  onAskInputData: (
    callback: (payload: AskInputPayload) => void,
  ): (() => void) => {
    const listener: IpcRendererListener = (_event, payload) => {
      const parsed = AskInputPayloadSchema.safeParse(payload);
      if (parsed.success) callback(parsed.data);
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
   * Subscribes to the "this ask was abandoned" signal main emits from every
   * dismissal path — Cmd-W, the red X and a profile switch as well as ESC.
   * Only ESC originates in the renderer, so without this the window keeps the
   * abandoned question and its ghost suggestion and can flash both over the
   * next, unrelated ask. Payload-free on purpose: there is nothing to validate,
   * and nothing about the abandoned ask the renderer should be told.
   */
  onAskInputDismissed: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("ask-input-dismissed", listener);
    return () => ipcRenderer.removeListener("ask-input-dismissed", listener);
  },

  /**
   * Subscribes to ask-result payloads (the question + answer to render) from
   * the main process. Call {@link signalAskResultReady} after installing this
   * listener so the first payload is not lost.
   */
  onAskResultData: (
    callback: (payload: AskResultPayload) => void,
  ): (() => void) => {
    const listener: IpcRendererListener = (_event, payload) => {
      const parsed = AskResultPayloadSchema.safeParse(payload);
      if (parsed.success) callback(parsed.data);
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
