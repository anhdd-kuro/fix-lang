/**
 * @file ask.ts
 * @description Wire payload types for the Ask AI preset windows. Electron-free
 * and structural on purpose: both the main-process window modules and the
 * renderer read these across the preload boundary, so no type here may import
 * from `~/features/providers/store/apiStore` or `electron`.
 */

/**
 * Where the attached context came from, so the input window can SAY so.
 *
 * `selection` — the hotkey's own Cmd-C produced it, so it is what the user had
 * highlighted at that moment. `clipboard` — the copy produced nothing and this
 * is the clipboard's existing content, which may be minutes old and unrelated.
 *
 * The distinction is the whole reason attaching the clipboard is acceptable
 * here. Ask AI has no "nothing selected" abort, so silently attaching a stale
 * clipboard would send text the user never chose; labelled and removable in a
 * window they must still type into and submit, it is a visible offer instead.
 */
export type AskContextSource = "selection" | "clipboard";

/** Sent from the hotkey/main flow to the Ask input window. */
export type AskInputPayload = {
  /** Which correction preset (the "Ask AI" built-in, normally) is answering. */
  presetId: string;
  /** The current selection, carried in as optional context. Empty when nothing was selected. */
  context: string;
  /** Absent is read as `selection` — see `AskContextSource`. */
  contextSource?: AskContextSource;
  /**
   * The preset's system prompt as it will actually be sent.
   *
   * RENDERED BY MAIN AND SHOWN VERBATIM, like {@link contextDirectives} beside
   * it. Neither is a structure for the renderer to format: the point of showing
   * them is that the user can see WHAT LEAVES THE MACHINE, and a renderer that
   * re-formats is a second copy of the request's wording that can drift from
   * the one actually sent while still looking right.
   *
   * Optional because a window opened by a future flow may have no preset prompt
   * to state; absent means the row simply has nothing to show for it.
   */
  systemPrompt?: string;
  /**
   * The exact context/directive text appended to the request — the app locale,
   * the system language, the keyboard input source, the press time and the
   * recent preset names, as `~/main/keybindings/askEnvironment.ts` rendered
   * them. The same string rides every autocomplete dispatch from this window.
   */
  contextDirectives?: string;
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
