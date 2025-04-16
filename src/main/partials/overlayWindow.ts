import { BrowserWindow, app, screen } from "electron";
import spinnerOverlayHtml from "./overlay.html?asset";

/**
 * === Global Mouse Loading Spinner Overlay ===
 * This overlay window will be used to display a spinner next to the mouse cursor,
 * even outside the main app window (global overlay).
 * - Transparent, always-on-top, frameless, click-through, hidden by default
 * - Will be moved/shown as needed in future steps
 */
let overlayWindow: BrowserWindow | null = null;
let spinnerTrackingInterval: NodeJS.Timeout | null = null;

// Exported direct control functions for the overlay spinner
// Show the overlay spinner and start following the mouse
export const showOverlaySpinner = () => {
  if (!overlayWindow) return;
  console.log("Showing overlay spinner");

  overlayWindow.showInactive();
  if (spinnerTrackingInterval) clearInterval(spinnerTrackingInterval);

  spinnerTrackingInterval = setInterval(() => {
    if (!overlayWindow || !overlayWindow.isVisible()) return;
    const { x, y } = screen.getCursorScreenPoint();
    overlayWindow.setPosition(x + 8, y + 8, false);
  }, 1000 / 60); // 60Hz polling
};

// Hide the overlay spinner and stop following the mouse
export const hideOverlaySpinner = () => {
  console.log("Hiding overlay spinner");

  overlayWindow?.hide();
  if (spinnerTrackingInterval) clearInterval(spinnerTrackingInterval);
  spinnerTrackingInterval = null;
};

/**
 * Creates the global mouse overlay window for the loading spinner.
 * Returns the window instance, or existing one if already created
 * Implements click-through using setIgnoreMouseEvents
 */
export const createOverlayWindow = (): BrowserWindow => {
  if (overlayWindow) return overlayWindow;
  overlayWindow = new BrowserWindow({
    width: 20,
    height: 20,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
    },
  });
  // Prevent overlay from appearing in task switchers
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Enable click-through so overlay never blocks mouse events (production)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(spinnerOverlayHtml);

  overlayWindow.once("ready-to-show", () => {
    console.log("Overlay window created", overlayWindow);
  });

  return overlayWindow;
};

/**
 * Ensures the overlay window is created when the app is ready (hidden by default).
 */
export const initializeOverlayWindow = () => {
  app.whenReady().then(() => {
    createOverlayWindow();
  });
  app.on("will-quit", () => {
    destroyOverlayWindow();
  });
};

export const destroyOverlayWindow = () => {
  overlayWindow?.destroy();
  overlayWindow = null;
  if (spinnerTrackingInterval) {
    clearInterval(spinnerTrackingInterval);
    spinnerTrackingInterval = null;
  }
};
