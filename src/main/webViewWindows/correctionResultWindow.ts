import path from "node:path";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { attachThemeSync } from "./attachThemeSync";
import type { CorrectionResultPayload } from "~/shared/correctionResult";

const WINDOW_WIDTH = 560;
const WINDOW_HEIGHT = 400;
const CURSOR_OFFSET = 16;

let resultWindow: BrowserWindow | null = null;
let rendererReady = false;
let currentPayload: CorrectionResultPayload | null = null;

/**
 * Sends the current payload only after the renderer has registered its
 * IPC listener (signaled via correction-result-ready).
 */
const sendCurrentPayload = (): void => {
  if (
    !rendererReady ||
    !currentPayload ||
    !resultWindow ||
    resultWindow.isDestroyed()
  ) {
    return;
  }
  resultWindow.webContents.send("correction-result-data", currentPayload);
};

const revealWindow = (): void => {
  if (!resultWindow || resultWindow.isDestroyed()) return;
  sendCurrentPayload();
  resultWindow.show();
  resultWindow.focus();
};

const createCorrectionResultWindow = (): BrowserWindow => {
  if (resultWindow && !resultWindow.isDestroyed()) return resultWindow;

  rendererReady = false;
  resultWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 420,
    minHeight: 280,
    show: false,
    skipTaskbar: true,
    title: "FixLang result",
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });

  resultWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachThemeSync(resultWindow);

  // Reset readiness when a load starts so DevTools reloads wait for a new
  // handshake instead of pushing into a listener that no longer exists.
  resultWindow.webContents.on("did-start-loading", () => {
    rendererReady = false;
  });

  resultWindow.on("close", (event) => {
    event.preventDefault();
    resultWindow?.hide();
  });

  resultWindow.on("closed", () => {
    resultWindow = null;
    rendererReady = false;
  });

  const html = path.join(
    __dirname,
    "../renderer/CorrectionResultWindow/index.html",
  );
  void resultWindow.loadFile(html);
  return resultWindow;
};

/**
 * Shows the correction result popup near the cursor with the given payload.
 * The payload is held until the renderer signals it is ready to receive IPC.
 */
export const showCorrectionResultWindow = (
  payload: CorrectionResultPayload,
): void => {
  currentPayload = payload;
  const win = createCorrectionResultWindow();
  const cursor = screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(cursor).workArea;
  const x = Math.min(
    Math.max(cursor.x + CURSOR_OFFSET, workArea.x),
    workArea.x + workArea.width - WINDOW_WIDTH,
  );
  const y = Math.min(
    Math.max(cursor.y + CURSOR_OFFSET, workArea.y),
    workArea.y + workArea.height - WINDOW_HEIGHT,
  );

  win.setPosition(x, y, false);
  if (rendererReady) {
    revealWindow();
  }
};

ipcMain.on("correction-result-ready", () => {
  rendererReady = true;
  revealWindow();
});

ipcMain.on("close-correction-result-window", () => resultWindow?.hide());

app.on("before-quit", () => {
  if (resultWindow && !resultWindow.isDestroyed()) {
    resultWindow.removeAllListeners("close");
    resultWindow.destroy();
  }
  resultWindow = null;
  rendererReady = false;
});
