/**
 * @file ask.ts
 * @description Wire payload types for the Ask AI preset windows. Electron-free
 * and structural on purpose: both the main-process window modules and the
 * renderer read these across the preload boundary, so no type here may import
 * from `~/features/providers/store/apiStore` or `electron`.
 */

/** Sent from the hotkey/main flow to the Ask input window. */
export type AskInputPayload = {
  /** Which correction preset (the "Ask AI" built-in, normally) is answering. */
  presetId: string;
  /** The current selection, carried in as optional context. Empty when nothing was selected. */
  context: string;
}

/** Sent from the main flow to a newly opened Ask result window. */
export type AskResultPayload = {
  presetName?: string;
  question: string;
  answer: string;
  /**
   * The selection carried into Ask as optional context. Empty (or absent) when
   * nothing was selected — the common case — and then no input block is shown.
   */
  input?: string;
  /**
   * Snapshotted at request time from the markdown-output setting, so toggling
   * that setting later cannot retroactively change how an already-open result
   * window renders its answer.
   */
  markdown: boolean;
}
