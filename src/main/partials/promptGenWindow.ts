import path from "path";
import { BrowserWindow, screen, ipcMain, app } from "electron";
import appIcon from "../../../resources/icon.ico?asset";

let promptGenWindow: BrowserWindow | null = null;

export type PromptGenPayload = {
  prompts: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  x: number;
  y: number;
  autoCopy: boolean;
};

export function createPromptGenWindow() {
  if (promptGenWindow && !promptGenWindow.isDestroyed()) return promptGenWindow;
  promptGenWindow = new BrowserWindow({
    width: 600,
    height: 500,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#1e2939",
    icon: appIcon,
    titleBarStyle: "default",
    title: "Generated Prompts",
    frame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.mjs"),
      contextIsolation: true,
      devTools: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  promptGenWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  ipcMain.on("close-promptGen-window", () => promptGenWindow?.hide());
  app.on("will-quit", () => {
    destroyPromptGenWindow();
  });

  promptGenWindow.on("closed", () => {
    promptGenWindow = null;
  });
  return promptGenWindow;
}

export function destroyPromptGenWindow() {
  if (promptGenWindow && !promptGenWindow.isDestroyed()) {
    promptGenWindow.close();
  }
  promptGenWindow = null;
}

export function showPromptGenWindow(payload: PromptGenPayload) {
  const win = createPromptGenWindow();
  const { width, height } = win.getBounds();
  const display = screen.getPrimaryDisplay().bounds;
  let posX = payload.x;
  let posY = payload.y;
  if (posX + width > display.width) posX = display.width - width;
  if (posY + height > display.height) posY = display.height - height;

  win.setPosition(posX, posY, false);
  const html = path.join(__dirname, "../renderer/PromptGenWindow/index.html");
  win.loadFile(html);
  win.webContents.once("did-finish-load", () => {
    win.webContents.send("promptGen-data", payload);
    win.show();
    win.focus();
  });
}
