/**
 * @file tray.ts
 * @description Tray icon, menu, and related logic for FixLang.
 */
import path from "path";
import { Tray, nativeImage, app, BrowserWindow, ipcMain } from "electron";
import appIcon from "./tray.png?asset";

let trayWindow: BrowserWindow | null = null;

let appTray: Tray | null = null;

/**
 * Creates or returns the hidden tray BrowserWindow.
 */
export function createTrayWindow(): BrowserWindow {
  if (trayWindow) return trayWindow;
  trayWindow = new BrowserWindow({
    width: 300,
    height: 600,
    show: false,
    frame: false,
    resizable: false,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#1e2939",
    hasShadow: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.mjs"),
      contextIsolation: true,
      devTools: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Prevent overlay from appearing in task switchers
  trayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const trayWindowHtml = path.join(
    __dirname,
    "../renderer/TrayWindow/index.html"
  );
  // Load standalone HTML for tray tray
  trayWindow.loadFile(trayWindowHtml);
  trayWindow.on("blur", hideTrayWindow);
  return trayWindow;
}

/**
 * Show or hide tray at tray icon with specified view
 */
export function showTrayWindow() {
  console.log("Showing tray window", trayWindow);

  // Only show tray if tray is initialized
  if (!trayWindow) return;
  // Toggle tray visibility
  if (trayWindow.isVisible()) {
    hideTrayWindow();
    return;
  }
  trayWindow.showInactive();
  trayWindow.focus();

  const bounds = getAppTrayBounds();
  if (!bounds) return;
  const { width: wW, height: wH } = trayWindow.getBounds();
  const x = Math.round(bounds?.x + bounds?.width / 2 - wW / 2);
  const y = process.platform === "darwin" ? bounds?.y : bounds?.y - wH;
  trayWindow.setPosition(x, y, false);
}

/**
 * Hides the tray window.
 */
export function hideTrayWindow(): void {
  trayWindow?.hide();
}

/**
 * Initializes the tray window on app ready and sets up IPC handlers.
 */
export function initializeTrayWindow(): void {
  app.whenReady().then(() => {
    createTrayWindow();
    ipcMain.on("hide-tray", () => {
      hideTrayWindow();
    });
  });

  app.on("will-quit", () => {
    if (trayWindow) {
      trayWindow.destroy();
      trayWindow = null;
    }
  });
}

export const setupTray = () => {
  try {
    const trayIcon = nativeImage.createFromPath(appIcon);
    appTray = new Tray(trayIcon);
    appTray.setToolTip("FixLang");
    appTray.on("click", () => {
      console.log("Tray clicked");
      showTrayWindow();
    });
  } catch (err) {
    console.error("Failed to initialize app tray:", err);
  }
};

export const getAppTrayBounds = () => {
  if (!appTray) return null;
  return appTray.getBounds();
};
