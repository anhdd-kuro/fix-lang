/**
 * @file init.ts
 * @description Application initialization and lifecycle management
 */
import { app, BrowserWindow } from "electron";
import {
  isMacOSAccessibilityGranted,
  promptAccessibilityPermission,
} from "../utils";
import {
  registerApiHandlers,
  registerCorrectionHandlers,
  setupHistoryManagerHandlers,
  registerPromptGenHandlers,
  registerSettingsHandlers,
  registerSummarizationHandlers,
  registerTranslationHandlers,
  registerUiHandlers,
} from "./ipc/features";
import { registerHotkeys, unregisterHotkeys } from "./keybindings";
import {
  initializeMainWindow,
  getMainWindow,
  initializeOverlayWindow,
  initializeTrayWindow,
  setupTray,
} from "./partials";

const registerIpcHandlers = (): void => {
  // Register all feature handlers in a specific order (UI-first approach)
  registerUiHandlers();
  registerApiHandlers();
  registerSettingsHandlers();

  // Register centralized history handler first (dependency for feature handlers)
  setupHistoryManagerHandlers();

  // Register feature-specific handlers
  registerCorrectionHandlers();
  registerTranslationHandlers();
  registerSummarizationHandlers();
  registerPromptGenHandlers();

  console.log("All IPC handlers registered successfully");
};

function initializeApp() {
  console.log("Initializing application...");

  // --- Global Overlay Spinner ---
  initializeOverlayWindow();

  // Tray window for inline settings/history
  initializeTrayWindow();

  // Register all IPC handlers
  registerIpcHandlers();

  // Initialize main application window
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
}

initializeApp();
