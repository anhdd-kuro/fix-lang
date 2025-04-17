import { app, BrowserWindow } from "electron"; // Main Electron imports
import {
  isMacOSAccessibilityGranted,
  promptAccessibilityPermission,
} from "../utils";
import { registerHotkeys, unregisterHotkeys } from "./partials/hotkey";
import { registerIpcHandlers } from "./partials/ipc";
import { initializeMainWindow, getMainWindow } from "./partials/mainWindow";
import { initializeOverlayWindow } from "./partials/overlayWindow";
import { setupTray, initializeTrayWindow } from "./partials/tray";

// --- Global Overlay Spinner ---
initializeOverlayWindow();
// Tray window for inline settings/history
initializeTrayWindow();
registerIpcHandlers();
initializeMainWindow();

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;
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
      initializeMainWindow();
    }
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
