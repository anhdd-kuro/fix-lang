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

  resultWindow.webContents.on("did-finish-load", () => {
    rendererReady = true;
    sendCurrentPayload();
    resultWindow?.show();
    resultWindow?.focus();
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
    sendCurrentPayload();
    win.show();
    win.focus();
  }
};

ipcMain.on("close-correction-result-window", () => resultWindow?.hide());

app.on("before-quit", () => {
  if (resultWindow && !resultWindow.isDestroyed()) {
    resultWindow.removeAllListeners("close");
    resultWindow.destroy();
  }
  resultWindow = null;
  rendererReady = false;
});
