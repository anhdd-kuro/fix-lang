import { app, BrowserWindow, screen } from "electron";
import { themeStore } from "~/stores/themeStore";
import errorPopupHtml from "./overlay.html?asset";
import { buildErrorPopupTitle } from "./windowTitles";
import type { ThemeId } from "~/stores/themeIds";

const ERROR_POPUP_WIDTH = 360;
const ERROR_POPUP_HEIGHT = 112;
const ERROR_POPUP_OFFSET = 20;
const ERROR_POPUP_DURATION_MS = 8_000;

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

const displayErrorPopup = (message: string): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed() || !errorPopupReady) {
    return;
  }

  const popup = errorPopupWindow;
  const title = buildErrorPopupTitle();
  void popup.webContents
    .executeJavaScript(
      `document.body.dataset.overlayMode = "error"; document.querySelector(".error-title").textContent = ${JSON.stringify(title)}; document.querySelector("#error-message").textContent = ${JSON.stringify(message)};`,
    )
    .then(() => {
      if (popup.isDestroyed() || pendingMessage !== message) return;

      positionErrorPopup();
      popup.showInactive();
      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => {
        popup.hide();
        dismissTimer = null;
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
    focusable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
    },
  });
  errorPopupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  errorPopupWindow.setIgnoreMouseEvents(true, { forward: true });
  errorPopupWindow.loadFile(errorPopupHtml);
  errorPopupWindow.webContents.on("did-finish-load", () => {
    errorPopupReady = true;
    syncErrorPopupTheme(themeStore.getThemeId());
    syncErrorPopupLocale();
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

export const syncErrorPopupTheme = (themeId: ThemeId): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed()) return;

  void errorPopupWindow.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(themeId)}`,
  );
};

/**
 * Refreshes the `.error-title` heading to the current locale, the same way
 * {@link syncErrorPopupTheme} pushes the theme: an `executeJavaScript` call
 * against the standalone `overlay.html` document (no renderer/preload script
 * runs there to react to a `locale-changed` IPC message on its own). Called on
 * load and again whenever `displayErrorPopup` shows a new message, so the
 * title is never a locale switch behind.
 */
export const syncErrorPopupLocale = (): void => {
  if (!errorPopupWindow || errorPopupWindow.isDestroyed()) return;

  void errorPopupWindow.webContents.executeJavaScript(
    `document.querySelector(".error-title").textContent = ${JSON.stringify(buildErrorPopupTitle())}`,
  );
};
