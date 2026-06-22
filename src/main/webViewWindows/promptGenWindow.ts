import path from "path";
import { BrowserWindow, screen, ipcMain, app } from "electron";
import { attachThemeSync } from "./attachThemeSync";
import appIcon from "../../../resources/icon.ico?asset";

let promptGenWindow: BrowserWindow | null = null;

export type PromptGenPayload = {
  prompts: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  x: number;
  y: number;
  model?: string;
  resolvedModel?: string;
};

export function createPromptGenWindow() {
  if (promptGenWindow && !promptGenWindow.isDestroyed()) return promptGenWindow;
  promptGenWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    transparent: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#1e2939",
    icon: appIcon,
    titleBarStyle: "default",
    title: "Generated Prompts",
    frame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });
  promptGenWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  attachThemeSync(promptGenWindow);

  ipcMain.on("close-promptGen-window", () => promptGenWindow?.hide());
  app.on("will-quit", () => {
    destroyPromptGenWindow();
  });

  promptGenWindow.on("closed", () => {
    destroyPromptGenWindow();
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
  console.log("showPromptGenWindow called with:", payload);
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
  win.once("ready-to-show", () => {
    win.show();

    setTimeout(() => {
      win.webContents.send("promptGen-data", payload);
    }, 300);
  });
}
