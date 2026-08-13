import { BrowserWindow, app, screen } from "electron";
import { appearanceStore } from "~/features/appearance/store/appearanceStore";
import { themeStore } from "~/features/theme/store/themeStore";
import { buildComboProgressStyle, type ComboProgressView } from "./comboProgressView";
import spinnerOverlayHtml from "./overlay.html?asset";
import { applyStandaloneTypography } from "./syncStandaloneTypography";
import type { ThemeId } from "~/features/theme/store/themeIds";

/**
 * === Global Mouse Loading Spinner Overlay ===
 * This overlay window will be used to display a spinner next to the mouse cursor,
 * even outside the main app window (global overlay).
 * - Transparent, always-on-top, frameless, click-through, hidden by default
 * - Will be moved/shown as needed in future steps
 *
 * Also hosts the combo progress ring (plan O1-O5): same window, same size,
 * repurposed via `updateComboProgress` instead of a second window.
 */
// O2 — fixed for every mode (plain spinner and combo ring alike). A 20px box
// cannot hold a legible digit; growing it per-mode would race the 60Hz
// `setPosition` loop below, so it is one constant, not a per-call choice.
// 24 is a bit smaller than the original 28 while still holding the combo digit.
const OVERLAY_SIZE = 24;
const OVERLAY_CURSOR_OFFSET = 10;

let overlayWindow: BrowserWindow | null = null;
let spinnerTrackingInterval: NodeJS.Timeout | null = null;
// Mirrors errorPopupWindow's `errorPopupReady`: `did-finish-load` gates any
// call that injects `window.__setComboProgress` (defined in overlay.html),
// since that global does not exist in the document until the load fires.
let overlayReady = false;

// Exported direct control functions for the overlay spinner
// Show the overlay spinner and start following the mouse
export const showOverlaySpinner = () => {
  if (!overlayWindow) return;
  console.log("Showing overlay spinner");

  // A previous combo run may have left the ring mode on this same window;
  // an ordinary single-preset run always means the plain spinner.
  void overlayWindow.webContents.executeJavaScript(
    `document.body.dataset.overlayMode = ""`,
  );
  overlayWindow.showInactive();
  if (spinnerTrackingInterval) clearInterval(spinnerTrackingInterval);

  spinnerTrackingInterval = setInterval(() => {
    if (!overlayWindow || !overlayWindow.isVisible()) return;
    const { x, y } = screen.getCursorScreenPoint();
    overlayWindow.setPosition(x + OVERLAY_CURSOR_OFFSET, y + OVERLAY_CURSOR_OFFSET, false);
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
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE,
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

  overlayWindow.webContents.on("did-finish-load", () => {
    overlayReady = true;
    syncOverlayTheme(themeStore.getThemeId());
    syncOverlayTypography(appearanceStore.getTypography());
  });

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
  overlayReady = false;
  if (spinnerTrackingInterval) {
    clearInterval(spinnerTrackingInterval);
    spinnerTrackingInterval = null;
  }
};

/**
 * Applies the active theme to the overlay spinner document.
 */

/**
 * Applies the active typography settings to the overlay spinner document.
 */
export const syncOverlayTypography = (
  typography = appearanceStore.getTypography(),
): void => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  applyStandaloneTypography(overlayWindow.webContents, typography);
};

export const syncOverlayTheme = (themeId: ThemeId): void => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  void overlayWindow.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(themeId)}`,
  );
};

/**
 * Renders one combo step boundary onto the overlay (O5 — all geometry
 * already decided by `buildComboProgressStyle`; this only ships the result
 * across the `executeJavaScript` round trip, exactly like `syncOverlayTheme`).
 * Exactly one call per step boundary — `window.__setComboProgress` in
 * `overlay.html` assigns the CSS vars and digit verbatim, nothing else.
 */
export const updateComboProgress = (view: ComboProgressView): void => {
  // `overlayReady` (set on `did-finish-load`, see `createOverlayWindow`)
  // guards against a step boundary landing before `window.__setComboProgress`
  // exists in the document. Without it, `executeJavaScript` rejects with a
  // ReferenceError that nothing here awaits, and that unhandled rejection
  // reaches the global `process.on("unhandledRejection")` in
  // `src/main/index.ts`, which shows the user a real FATAL error notification
  // for what is actually a harmless startup race. A dropped progress frame is
  // nothing — the next step boundary repaints the ring — so this degrades
  // silently instead.
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayReady) {
    return;
  }

  const style = buildComboProgressStyle(view);
  overlayWindow.webContents
    .executeJavaScript(`window.__setComboProgress(${JSON.stringify(style)})`)
    .catch((error: unknown) => {
      console.debug("Dropped combo progress update:", error);
    });
};
