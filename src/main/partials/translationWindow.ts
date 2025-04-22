import path from "path";
import { BrowserWindow, screen, ipcMain, app } from "electron";
import appIcon from "../../../resources/icon.ico?asset";

let translationWindow: BrowserWindow | null = null;

/**
 * Creates the translation window if it doesn't exist.
 */
export function createTranslationWindow() {
  if (translationWindow && !translationWindow.isDestroyed())
    return translationWindow;
  translationWindow = new BrowserWindow({
    width: 500,
    height: 350,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#1e2939",
    icon: appIcon,
    title: "Translation",
    titleBarStyle: "default",
    frame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.mjs"),
      contextIsolation: true,
      devTools: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  translationWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  // Page load will occur on show, not here

  translationWindow.once("ready-to-show", () => {
    if (translationWindow) console.log("Translation window created");
  });

  // Close on blur or close message
  // translationWindow.on("blur", () => translationWindow?.hide());
  ipcMain.on("close-translation-window", () => translationWindow?.hide());
  app.on("will-quit", () => {
    destroyTranslationWindow();
  });

  translationWindow.on("closed", () => {
    translationWindow = null;
  });
  return translationWindow;
}

/**
 * Shows the translation window with content at (x, y).
 */
export type TranslationPayload = {
  translatedText: string;
  promptTokens: number | null;
  completionTokens: number | null;
  x: number;
  y: number;
  originalText?: string;
  targetLang?: string;
  loading?: boolean;
  error?: string;
};

export const destroyTranslationWindow = () => {
  if (translationWindow && !translationWindow.isDestroyed()) {
    translationWindow.close();
  }
  translationWindow = null;
};

export function showTranslationWindow(payload: TranslationPayload) {
  const win = createTranslationWindow();
  const { width, height } = win.getBounds();
  const display = screen.getPrimaryDisplay().bounds;
  // adjust to stay within screen
  let posX = payload.x;
  let posY = payload.y;
  if (posX + width > display.width) posX = display.width - width;
  if (posY + height > display.height) posY = display.height - height;

  win.setPosition(posX, posY, false);
  // Reload UI and wait for renderer to finish loading
  const html = path.join(__dirname, "../renderer/TranslationWindow/index.html");
  win.loadFile(html);
  win.webContents.once("did-finish-load", () => {
    // Send payload after UI is ready
    win.webContents.send("translation-data", payload);
    win.showInactive();
  });
}

/**
 * Hides the translation window.
 */
export function hideTranslationWindow() {
  translationWindow?.hide();
}
