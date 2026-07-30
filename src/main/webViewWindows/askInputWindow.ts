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
import { attachThemeSync } from "./attachThemeSync";
import { clampToWorkArea } from "./cursorPlacement";
import { buildAskInputWindowTitle } from "./windowTitles";
import type { AskInputPayload } from "~/shared/ask";

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
 * Runs the shared dismissal path for every way the Ask input window can be
 * abandoned without submitting — ESC (via `ask-input-cancel`), Cmd-W, and the
 * red X. All three are the same user intent and must produce the same
 * effect: `onCancel` fires exactly once and `currentHandlers` is cleared, so
 * the invoking flow is told the ask was abandoned and a later
 * `showAskInputWindow` never silently overwrites a still-live handler pair.
 * Reading-then-nulling `currentHandlers` up front makes a second dismissal
 * (e.g. a chrome close arriving after an already-processed cancel) a no-op
 * instead of a double `onCancel` call.
 *
 * Exported for `notifyActiveProfileChanged`: a pending ask must not survive a
 * profile switch, because `runAskFlow` re-resolves the preset id against
 * whatever profile is active at SUBMIT time.
 */
export const dismissAskInputWindow = (): void => {
  const handlers = currentHandlers;
  currentHandlers = null;
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

ipcMain.on("ask-input-submit", (_event, question: unknown) => {
  const handlers = currentHandlers;
  currentHandlers = null;
  hideAskInputWindow();
  if (typeof question === "string" && handlers) {
    handlers.onSubmit(question);
  }
});

ipcMain.on("ask-input-cancel", () => {
  dismissAskInputWindow();
});

app.on("before-quit", () => {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.removeAllListeners("close");
    inputWindow.destroy();
  }
  inputWindow = null;
  rendererReady = false;
  currentHandlers = null;
});
