/**
 * @file askInputWindow.ts
 * @description Ask AI input popup: a creation-cached singleton, same shape as
 * `correctionResultWindow.ts` (see that file for the traps this mirrors —
 * `page-title-updated` prevention, the `did-start-loading` readiness reset,
 * and the ready handshake so the first payload is never lost). Unlike the
 * result window, this one stays a plain singleton: only one Ask input can be
 * in flight at a time.
 */
import path from "node:path";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { abortAutocomplete } from "~/features/autocomplete/main/service";
import { attachThemeSync } from "./attachThemeSync";
import { clampToWorkArea } from "./cursorPlacement";
import { buildAskInputWindowTitle } from "./windowTitles";
import type { AskInputPayload } from "~/features/ask/shared/ask";

const WINDOW_WIDTH = 520;
const WINDOW_HEIGHT = 200;

/** Called with the submitted question text. */
export type AskInputSubmitHandler = (question: string) => void;
/** Called when the input window is dismissed without submitting. */
export type AskInputCancelHandler = () => void;

export type AskInputHandlers = {
  onSubmit: AskInputSubmitHandler;
  onCancel: AskInputCancelHandler;
};

let inputWindow: BrowserWindow | null = null;
let rendererReady = false;
let currentPayload: AskInputPayload | null = null;
let currentHandlers: AskInputHandlers | null = null;

/**
 * Sends the current payload only after the renderer has registered its IPC
 * listener (signaled via ask-input-ready).
 */
const sendCurrentPayload = (): void => {
  if (
    !rendererReady ||
    !currentPayload ||
    !inputWindow ||
    inputWindow.isDestroyed()
  ) {
    return;
  }
  inputWindow.webContents.send("ask-input-data", currentPayload);
};

/**
 * Tells the renderer the current ask has been abandoned so it drops the typed
 * question and any ghost suggestion still on screen or in flight.
 *
 * Needed because only ESC originates in the renderer: Cmd-W, the red X and a
 * profile switch all reach `dismissAskInputWindow` from here with nothing sent
 * back. The window is hidden rather than destroyed, so whatever it was showing
 * survives — and `revealWindow` shows the reopened window right after pushing
 * the new payload, giving the abandoned question and its ghost a frame to paint
 * over a fresh, unrelated ask.
 *
 * Sent unconditionally on every dismissal, ESC included: the renderer's own
 * reset is idempotent, and a send that is sometimes skipped is how three of
 * four paths came to be missed in the first place.
 */
const notifyRendererDismissed = (): void => {
  if (!inputWindow || inputWindow.isDestroyed()) return;
  inputWindow.webContents.send("ask-input-dismissed");
};

const revealWindow = (): void => {
  if (!inputWindow || inputWindow.isDestroyed()) return;
  sendCurrentPayload();
  inputWindow.show();
  inputWindow.focus();
};

const createAskInputWindow = (): BrowserWindow => {
  if (inputWindow && !inputWindow.isDestroyed()) return inputWindow;

  rendererReady = false;
  inputWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 420,
    minHeight: 160,
    show: false,
    skipTaskbar: true,
    title: buildAskInputWindowTitle(),
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });

  inputWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachThemeSync(inputWindow);

  // Electron's default behavior re-titles the native window from the loaded
  // document's <title> tag (a static, English-only fallback in index.html)
  // once it finishes parsing. Without this, that would silently clobber the
  // locale-aware title set above and by `syncAskInputWindowLocale`.
  inputWindow.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // Reset readiness when a load starts so DevTools reloads wait for a new
  // handshake instead of pushing into a listener that no longer exists.
  inputWindow.webContents.on("did-start-loading", () => {
    rendererReady = false;
  });

  inputWindow.on("close", (event) => {
    event.preventDefault();
    dismissAskInputWindow();
  });

  inputWindow.on("closed", () => {
    inputWindow = null;
    rendererReady = false;
  });

  const html = path.join(__dirname, "../renderer/AskInputWindow/index.html");
  void inputWindow.loadFile(html);
  return inputWindow;
};

const hideAskInputWindow = (): void => {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.hide();
  }
};

/**
 * Aborts THIS window's own in-flight autocomplete session, if it has one.
 * Shared by every path that ends the current ask without letting a stale
 * ghost-text request run to completion: dismissal (ESC, Cmd-W, the red X, a
 * profile switch) and submission alike. Submitting is not "the ghost
 * answered" — it is "the user moved on before it did" — so a request still in
 * flight for the OLD prefix bills exactly the same as one left running after
 * a dismissal, and its answer is discarded the same way.
 *
 * Scoped to `String(webContents.id)` — the same string
 * `autocomplete-suggest`'s handler derives from `event.sender.id`, per
 * `src/features/autocomplete/main/ipc.ts` — never a bare abort-everything.
 * Ask input is the only ghost-text surface today, so the two are equivalent
 * in practice, but a future composer window would run its own session under
 * its own id, and a bare abort-everything here would cancel that unrelated
 * request too. Callers read this ahead of `hideAskInputWindow()` while
 * `inputWindow` is still known live — hiding only calls `.hide()` and does
 * not destroy the window, but staying ahead of it means this does not depend
 * on that remaining true. Guarded exactly like `notifyRendererDismissed`: no
 * window, or an already-destroyed one, has no session id to abort and must
 * not throw.
 */
const abortWindowAutocomplete = (): void => {
  if (inputWindow && !inputWindow.isDestroyed()) {
    abortAutocomplete(String(inputWindow.webContents.id));
  }
};

/**
 * Runs the shared dismissal path for every way the Ask input window can be
 * abandoned without submitting — ESC (via `ask-input-cancel`), Cmd-W, and the
 * red X. All three are the same user intent and must produce the same
 * effect: `onCancel` fires exactly once, `currentHandlers` is cleared, the
 * renderer is told (see {@link notifyRendererDismissed}), and any autocomplete
 * request this window has in flight is aborted (see
 * {@link abortWindowAutocomplete}) — so the invoking flow is told the ask was
 * abandoned, a later `showAskInputWindow` never silently overwrites a
 * still-live handler pair, the hidden window holds no abandoned question or
 * ghost suggestion to flash on the next open, and a suggestion nobody will
 * read stops billing the moment the window goes away instead of running to
 * completion.
 * Reading-then-nulling `currentHandlers` up front makes a second dismissal
 * (e.g. a chrome close arriving after an already-processed cancel) a no-op
 * instead of a double `onCancel` call.
 *
 * Exported for `notifyActiveProfileChanged`: a pending ask must not survive a
 * profile switch, because `runAskFlow` re-resolves the preset id against
 * whatever profile is active at SUBMIT time. `notifyActiveProfileChanged`
 * separately calls the bare, all-sessions `abortAutocomplete()` afterward —
 * correct there because a profile switch invalidates every surface's request,
 * not just this window's.
 */
export const dismissAskInputWindow = (): void => {
  const handlers = currentHandlers;
  currentHandlers = null;
  abortWindowAutocomplete();
  notifyRendererDismissed();
  hideAskInputWindow();
  handlers?.onCancel();
};

/**
 * Shows the Ask input popup near the cursor with the given payload, calling
 * `handlers.onSubmit`/`handlers.onCancel` once the renderer reports a
 * question or a dismissal. The window is hidden (not destroyed) either way,
 * since it is a reusable singleton.
 */
export const showAskInputWindow = (
  payload: AskInputPayload,
  handlers: AskInputHandlers,
): void => {
  currentPayload = payload;
  currentHandlers = handlers;
  const win = createAskInputWindow();
  const cursor = screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(cursor).workArea;
  const { x, y } = clampToWorkArea({
    cursor,
    workArea,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });

  win.setPosition(x, y, false);
  if (rendererReady) {
    revealWindow();
  }
};

/**
 * Retitles an already-open Ask input window to the current locale. `title` is
 * only read once, at `BrowserWindow` construction, and this window is a
 * creation-cached singleton — so without this, a window opened before a
 * locale switch keeps showing the previous language. Mirrors
 * `syncCorrectionResultWindowLocale` in `correctionResultWindow.ts`.
 */
export const syncAskInputWindowLocale = (): void => {
  if (!inputWindow || inputWindow.isDestroyed()) return;
  inputWindow.setTitle(buildAskInputWindowTitle());
};

ipcMain.on("ask-input-ready", () => {
  rendererReady = true;
  revealWindow();
});

// Submitting is a real question, not a dismissal, but it still ends whatever
// ghost-text request was running for the prefix typed before this Enter —
// the renderer's own `clearGhost()` on submit only bumps its local request
// id so a late reply is ignored; it cannot reach a request already
// dispatched to the provider from the main process. Without this, that
// request ran to completion and billed for an answer nobody was ever going
// to read. Read before `hideAskInputWindow()`, same as the dismissal path.
ipcMain.on("ask-input-submit", (_event, question: unknown) => {
  const handlers = currentHandlers;
  currentHandlers = null;
  abortWindowAutocomplete();
  hideAskInputWindow();
  if (typeof question === "string" && handlers) {
    handlers.onSubmit(question);
  }
});

ipcMain.on("ask-input-cancel", () => {
  dismissAskInputWindow();
});

// Deliberately does NOT call `abortWindowAutocomplete()`. Nothing in this
// codebase calls `event.preventDefault()` on `before-quit` (the only
// `preventDefault` calls anywhere are on window `close` events, a different
// listener entirely — checked across every `webViewWindows/*.ts`), so once
// this handler runs the process is actually going to exit, not merely
// "asked to". At that point the OS tears down every open socket, including
// any autocomplete request still in flight, whether or not `abort()` fired
// first — the bytes already sent to the provider (and whatever it bills for
// them) are the same either way. `abortAutocomplete()` earns its keep only
// when the PROCESS keeps running past the request's end (a hidden window,
// or a dispatch superseded by the next keystroke); here nothing survives to
// benefit.
app.on("before-quit", () => {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.removeAllListeners("close");
    inputWindow.destroy();
  }
  inputWindow = null;
  rendererReady = false;
  currentHandlers = null;
});
