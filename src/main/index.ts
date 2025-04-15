import { app, BrowserWindow, ipcMain } from "electron"; // Main Electron imports
import path from "node:path";
import { registerHotkeys, unregisterHotkeys } from "./partials/hotkey";
import {
  isMacOSAccessibilityGranted,
  promptAccessibilityPermission,
} from "../utils";
import { initializeOverlayWindow } from "./partials/overlayWindow";
import { setupTray, updateTrayMenu } from "./partials/tray";
import { registerIpcHandlers } from "./partials/ipc";

// --- Global Overlay Spinner ---
initializeOverlayWindow();
registerIpcHandlers();

import { createMainWindow } from "./partials/mainWindow";

const createWindow = () => {
  // Create and get the singleton main window instance
  const mainWindow = createMainWindow();

  if (process.env.NODE_ENV === "development") {
    console.log("Development mode: Loading Vite dev server");
    mainWindow.loadURL("http://localhost:5175");
    mainWindow.webContents.openDevTools();
  } else {
    console.log("Production mode: Loading built file");
    const rendererPath = path.join(__dirname, "../renderer/index.html");
    console.log("Loading renderer from: " + rendererPath);
    mainWindow.loadFile(rendererPath);
  }

  return mainWindow;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  const mainWindow = createWindow(); // Get the main window instance
  app.setAccessibilitySupportEnabled(true);

  // --- macOS Tray and Menu Logic ---
  if (process.platform === "darwin") {
    if (!isMacOSAccessibilityGranted()) {
      console.warn("Accessibility permission not granted.");
      promptAccessibilityPermission();
    }
    app.dock?.show();
    setupTray();
  }

  registerHotkeys(mainWindow); // Register global shortcuts, passing the window

  app.on("activate", () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Listen for settings changes to update tray menu dynamically
  ipcMain.on("settings-updated", () => {
    updateTrayMenu();
  });
});

// Quit when all windows are closed, except on macOS.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    unregisterHotkeys(); // Unregister shortcuts when closing
    app.quit();
  }
});

// Unregister shortcuts before quitting
app.on("will-quit", () => {
  // Unregister all shortcuts on quit to be safe
  unregisterHotkeys();
});
