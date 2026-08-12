import { app, BrowserWindow, screen } from "electron";
import { appearanceStore } from "~/features/appearance/store/appearanceStore";
import { themeStore } from "~/features/theme/store/themeStore";
import errorPopupHtml from "./overlay.html?asset";
import { applyStandaloneTypography } from "./syncStandaloneTypography";
import {
  buildErrorPopupCloseLabel,
  buildErrorPopupTitle,
} from "./windowTitles";
import type { ThemeId } from "~/features/theme/store/themeIds";

const ERROR_POPUP_WIDTH = 360;
const ERROR_POPUP_HEIGHT = 112;
const ERROR_POPUP_OFFSET = 20;
const ERROR_POPUP_DURATION_MS = 8_000;

/**
 * In-page hash used by the close button in `overlay.html` (no preload on this
 * window). Intercepted via `did-navigate-in-page` so the singleton is hidden,
 * not destroyed, and can be shown again for the next error.
 */
export const ERROR_POPUP_DISMISS_HASH = "#dismiss";

let errorPopupWindow: BrowserWindow | null = null;
let dismissTimer: NodeJS.Timeout | null = null;
let pendingMessage: string | null = null;
let errorPopupReady = false;

const positionErrorPopup = (): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed()) return;

  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const x = Math.min(
    Math.max(cursor.x + ERROR_POPUP_OFFSET, workArea.x),
    workArea.x + workArea.width - ERROR_POPUP_WIDTH,
  );
  const y = Math.min(
    Math.max(cursor.y + ERROR_POPUP_OFFSET, workArea.y),
    workArea.y + workArea.height - ERROR_POPUP_HEIGHT,
  );
  errorPopupWindow.setPosition(x, y, false);
};

/**
 * Hides the error popup and clears its auto-dismiss timer. Safe to call when
 * the window is already hidden or not yet created.
 */
export const hideErrorPopup = (): void => {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  pendingMessage = null;
  if (errorPopupWindow && !errorPopupWindow.isDestroyed()) {
    errorPopupWindow.hide();
    // Reset the dismiss hash so a later Close click fires `did-navigate-in-page`
    // again (setting the same hash twice is a no-op).
    void errorPopupWindow.webContents.executeJavaScript("location.hash = \"\"");
  }
};

const wireErrorPopupCloseButton = (): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed()) return;

  // Wire once per document load. The overlay has no preload, so the button
  // flips `location.hash`; main intercepts that via `did-navigate-in-page`.
  void errorPopupWindow.webContents.executeJavaScript(
    `(() => {
      const btn = document.getElementById("error-close");
      if (!btn || btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        location.hash = ${JSON.stringify(ERROR_POPUP_DISMISS_HASH.slice(1))};
      });
    })()`,
  );
};

const displayErrorPopup = (message: string): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed() || !errorPopupReady) {
    return;
  }

  const popup = errorPopupWindow;
  const title = buildErrorPopupTitle();
  const closeLabel = buildErrorPopupCloseLabel();
  void popup.webContents
    .executeJavaScript(
      `(() => {
        document.body.dataset.overlayMode = "error";
        document.querySelector(".error-title").textContent = ${JSON.stringify(title)};
        document.querySelector("#error-message").textContent = ${JSON.stringify(message)};
        const closeBtn = document.getElementById("error-close");
        if (closeBtn) closeBtn.setAttribute("aria-label", ${JSON.stringify(closeLabel)});
      })()`,
    )
    .then(() => {
      if (popup.isDestroyed() || pendingMessage !== message) return;

      positionErrorPopup();
      popup.showInactive();
      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => {
        hideErrorPopup();
      }, ERROR_POPUP_DURATION_MS);
    })
    .catch((error: unknown) => {
      console.error("Unable to render error popup:", error);
    });
};

export const createErrorPopupWindow = (): BrowserWindow => {
  if (errorPopupWindow) return errorPopupWindow;

  errorPopupWindow = new BrowserWindow({
    width: ERROR_POPUP_WIDTH,
    height: ERROR_POPUP_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    // Keep focusable so the close button can receive clicks without stealing
    // the user's previous app focus via `showInactive()` below.
    focusable: true,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
    },
  });
  errorPopupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Unlike the spinner overlay, the error popup must accept clicks on Close.
  errorPopupWindow.setIgnoreMouseEvents(false);
  errorPopupWindow.loadFile(errorPopupHtml);
  errorPopupWindow.webContents.on("did-navigate-in-page", (_event, url) => {
    if (url.includes(ERROR_POPUP_DISMISS_HASH)) {
      hideErrorPopup();
    }
  });
  errorPopupWindow.webContents.on("did-finish-load", () => {
    errorPopupReady = true;
    syncErrorPopupTheme(themeStore.getThemeId());
    syncErrorPopupTypography(appearanceStore.getTypography());
    syncErrorPopupLocale();
    wireErrorPopupCloseButton();
    if (pendingMessage) displayErrorPopup(pendingMessage);
  });
  errorPopupWindow.on("closed", () => {
    errorPopupWindow = null;
    errorPopupReady = false;
  });

  return errorPopupWindow;
};

export const showErrorPopup = (message: string): void => {
  pendingMessage = message;
  createErrorPopupWindow();
  displayErrorPopup(message);
};

export const initializeErrorPopupWindow = (): void => {
  app.whenReady().then(() => {
    createErrorPopupWindow();
  });
  app.on("will-quit", () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = null;
    errorPopupWindow?.destroy();
    errorPopupWindow = null;
    errorPopupReady = false;
  });
};


export const syncErrorPopupTypography = (
  typography = appearanceStore.getTypography(),
): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed()) return;

  applyStandaloneTypography(errorPopupWindow.webContents, typography);
};

export const syncErrorPopupTheme = (themeId: ThemeId): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed()) return;

  void errorPopupWindow.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(themeId)}`,
  );
};

/**
 * Refreshes the `.error-title` heading and close-button aria-label to the
 * current locale, the same way {@link syncErrorPopupTheme} pushes the theme:
 * an `executeJavaScript` call against the standalone `overlay.html` document
 * (no renderer/preload script runs there to react to a `locale-changed` IPC
 * message on its own). Called on load and again whenever `displayErrorPopup`
 * shows a new message, so the copy is never a locale switch behind.
 */
export const syncErrorPopupLocale = (): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed()) return;

  const title = buildErrorPopupTitle();
  const closeLabel = buildErrorPopupCloseLabel();
  void errorPopupWindow.webContents.executeJavaScript(
    `(() => {
      document.querySelector(".error-title").textContent = ${JSON.stringify(title)};
      const closeBtn = document.getElementById("error-close");
      if (closeBtn) closeBtn.setAttribute("aria-label", ${JSON.stringify(closeLabel)});
    })()`,
  );
};
