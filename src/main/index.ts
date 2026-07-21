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
  registerLogHandlers,
  registerOpenRouterHandlers,
  registerProfileHandlers,
  registerPromptGenHandlers,
  registerSettingsHandlers,
  registerThemeHandlers,
  registerUiHandlers,
  registerUpdateHandlers,
} from "./ipc/features";
import { registerHotkeys, unregisterHotkeys } from "./keybindings";
import { startModelMonitoring } from "./llm/models/monitor";
import { initializeUpdateService, type UpdateService } from "./update";
import { shouldCheckForUpdatesOnLaunch } from "./update/installationPath";
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
const UPDATE_CHECK_DELAY_MS = 1_500;

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

const registerIpcHandlers = (): UpdateService => {
  // Register all feature handlers in a specific order (UI-first approach)
  registerUiHandlers();
  registerApiHandlers();
  registerSettingsHandlers();
  registerThemeHandlers();

  // Register structured log handlers before feature handlers that emit logs.
  registerLogHandlers();

  // Register profile handlers (should be before other features that might use profiles)
  registerProfileHandlers();

  // Register centralized history handler first (dependency for feature handlers)
  setupHistoryManagerHandlers();

  // Register feature-specific handlers
  registerCorrectionHandlers();
  registerPromptGenHandlers();

  // OpenRouter account-analytics tab (#59) — reads the provisioning key in-main.
  registerOpenRouterHandlers();

  // Keep the service main-process only; renderer access is restricted to the
  // dedicated typed IPC feature above.
  const updateService = initializeUpdateService();
  registerUpdateHandlers(updateService);

  console.log("All IPC handlers registered successfully");
  return updateService;
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
    const updateService = registerIpcHandlers();

    // Initialize main application window
    initializeMainWindow();

    const mainWindow = createMainWindow();
    // Availability checks never block startup and never download without an
    // explicit user action in Settings. Development/unsupported builds and
    // packaged directory builds outside a standard Applications folder do not
    // schedule a network timer at all. Manual Settings checks remain available.
    if (
      updateService.getState().phase !== "unsupported" &&
      shouldCheckForUpdatesOnLaunch(app.getPath("exe"), app.getPath("home"))
    ) {
      setTimeout(() => {
        void updateService.checkForUpdates();
      }, UPDATE_CHECK_DELAY_MS);
    }
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
