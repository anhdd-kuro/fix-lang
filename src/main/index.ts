/**
 * @file init.ts
 * @description Application initialization and lifecycle management
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import {
  isMacOSAccessibilityGranted,
  promptAccessibilityPermission,
} from "../utils";
import {
  registerApiHandlers,
  registerCorrectionHandlers,
  setupHistoryManagerHandlers,
  registerOpenRouterHandlers,
  registerProfileHandlers,
  registerPromptGenHandlers,
  registerSettingsHandlers,
  registerUiHandlers,
} from "./ipc/features";
import { registerHotkeys, unregisterHotkeys } from "./keybindings";
import { startModelMonitoring } from "./llm/models/monitor";
import {
  initializeMainWindow,
  getMainWindow,
  initializeOverlayWindow,
  initializeTrayWindow,
  setupTray,
  createMainWindow,
} from "./webViewWindows";

const LOG_DIR = path.join(os.homedir(), ".fixlang", "log");
const LOG_FILE = path.join(
  LOG_DIR,
  `runtime-${new Date().toISOString().replace(/:/g, "-")}.log`,
);

const serializeLogArg = (arg: unknown): string => {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}\n${arg.stack || ""}`;
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

const appendRuntimeLog = (level: string, ...args: unknown[]): void => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${args
      .map((arg) => serializeLogArg(arg))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // no-op
  }
};

const setupRuntimeLogging = (): void => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    appendRuntimeLog("INFO", ...args);
    originalLog(...args);
  };

  console.warn = (...args: unknown[]) => {
    appendRuntimeLog("WARN", ...args);
    originalWarn(...args);
  };

  console.error = (...args: unknown[]) => {
    appendRuntimeLog("ERROR", ...args);
    originalError(...args);
  };

  process.on("uncaughtException", (error) => {
    appendRuntimeLog("FATAL", "uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    appendRuntimeLog("FATAL", "unhandledRejection", reason);
  });

  appendRuntimeLog("INFO", `runtime log initialized at ${LOG_FILE}`);
};

const registerIpcHandlers = (): void => {
  // Register all feature handlers in a specific order (UI-first approach)
  registerUiHandlers();
  registerApiHandlers();
  registerSettingsHandlers();

  // Register profile handlers (should be before other features that might use profiles)
  registerProfileHandlers();

  // Register centralized history handler first (dependency for feature handlers)
  setupHistoryManagerHandlers();

  // Register feature-specific handlers
  registerCorrectionHandlers();
  registerPromptGenHandlers();

  // OpenRouter account-analytics tab (#59) — reads the provisioning key in-main.
  registerOpenRouterHandlers();

  console.log("All IPC handlers registered successfully");
};

function initializeApp() {
  setupRuntimeLogging();
  console.log("Initializing application...");

  // Start local LLM model monitoring
  startModelMonitoring();

  // --- Global Overlay Spinner ---
  initializeOverlayWindow();

  // Tray window for inline settings/history
  initializeTrayWindow();

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(() => {
    // Register all IPC handlers
    registerIpcHandlers();

    // Initialize main application window
    initializeMainWindow();

    const mainWindow = createMainWindow();
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
  });

  // Handle macOS dock icon clicks - placed outside whenReady to ensure it's always registered
  app.on("activate", () => {
    // First check if any windows exist at all (to keep BrowserWindow in use)
    if (BrowserWindow.getAllWindows().length === 0) {
      // No windows at all, create a new one
      createMainWindow();
      return;
    }

    // Check if we have a valid main window reference
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Window exists but might be hidden - show and focus it
      mainWindow.show();
      mainWindow.focus();
    } else {
      // No valid main window exists, create a new one
      createMainWindow();
    }
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
