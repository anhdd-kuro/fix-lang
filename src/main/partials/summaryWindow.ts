import path from "path";
import { BrowserWindow, screen, ipcMain, app } from "electron";

let summaryWindow: BrowserWindow | null = null;

export type SummaryPayload = {
  summarizedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
  x: number;
  y: number;
};

export function createSummaryWindow() {
  if (summaryWindow && !summaryWindow.isDestroyed()) return summaryWindow;
  summaryWindow = new BrowserWindow({
    width: 400,
    height: 300,
    transparent: false,
    titleBarStyle: "hiddenInset",
    show: false,
    skipTaskbar: true,
    backgroundColor: "#1e2939",
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.mjs"),
      contextIsolation: true,
      devTools: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  summaryWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  ipcMain.on("close-summary-window", () => summaryWindow?.hide());
  app.on("will-quit", () => {
    destroySummaryWindow();
  });

  summaryWindow.on("closed", () => {
    summaryWindow = null;
  });
  return summaryWindow;
}

export function destroySummaryWindow() {
  if (summaryWindow && !summaryWindow.isDestroyed()) {
    summaryWindow.close();
  }
  summaryWindow = null;
}

export function showSummaryWindow(payload: SummaryPayload) {
  const win = createSummaryWindow();
  const { width, height } = win.getBounds();
  const display = screen.getPrimaryDisplay().bounds;
  let posX = payload.x;
  let posY = payload.y;
  if (posX + width > display.width) posX = display.width - width;
  if (posY + height > display.height) posY = display.height - height;

  win.setPosition(posX, posY, false);
  const html = path.join(__dirname, "../renderer/SummaryWindow/index.html");
  win.loadFile(html);
  win.once("ready-to-show", () => {
    win.show();

    // Send payload after UI is ready
    win.webContents.send("summary-data", payload);
  });
}
