/**
 * @file askResultWindow.ts
 * @description Ask AI result popup: multi-instance (unlike the
 * `correctionResultWindow.ts` singleton), capped at 5 simultaneously open
 * windows, keyed by `BrowserWindow.id` so a payload sent for window *k*
 * reaches window *k* only. Reuses the same proven traps as
 * `correctionResultWindow.ts` — `page-title-updated` prevention, the
 * `did-start-loading` readiness reset, the ready handshake — but deliberately
 * DOES NOT copy its `preventDefault` + `hide` close behavior: with up to five
 * live renderer processes, hiding instead of destroying would leak invisible
 * windows.
 */
import path from "node:path";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { attachThemeSync } from "./attachThemeSync";
import { clampToWorkArea } from "./cursorPlacement";
import { applyExternalNavigationGuard } from "./externalNavigationGuard";
import { buildAskResultWindowTitle } from "./windowTitles";
import type { AskResultPayload } from "~/features/ask/shared/ask";

const WINDOW_WIDTH = 560;
const WINDOW_HEIGHT = 420;
const MAX_ASK_RESULT_WINDOWS = 5;

type AskResultEntry = {
  window: BrowserWindow;
  payload: AskResultPayload;
  ready: boolean;
  cascadeIndex: number;
};

const resultWindows = new Map<number, AskResultEntry>();

/**
 * Finds the lowest cascade slot not currently occupied by a live window,
 * rather than deriving it from `resultWindows.size`. Using the count alone
 * collides with a still-open window whenever a non-newest window has closed
 * (the freed slot is skipped), and plateaus at the same offset once the cap
 * starts evicting (size stays constant post-eviction).
 */
const findLowestFreeCascadeIndex = (): number => {
  const occupiedIndices = new Set(
    Array.from(resultWindows.values(), (entry) => entry.cascadeIndex),
  );
  let index = 0;
  while (occupiedIndices.has(index)) {
    index += 1;
  }
  return index;
};

const findEntryForSender = (
  sender: Electron.WebContents,
): AskResultEntry | undefined => {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win) return undefined;
  return resultWindows.get(win.id);
};

const sendPayloadIfReady = (entry: AskResultEntry): void => {
  if (!entry.ready || entry.window.isDestroyed()) return;
  entry.window.webContents.send("ask-result-data", entry.payload);
};

const revealWindow = (entry: AskResultEntry): void => {
  if (entry.window.isDestroyed()) return;
  sendPayloadIfReady(entry);
  entry.window.show();
  entry.window.focus();
};

/**
 * Destroys the oldest tracked window (Map insertion order) once the cap is
 * reached, so a 6th `showAskResultWindow` call never exceeds 5 live windows.
 */
const evictOldestIfAtCapacity = (): void => {
  if (resultWindows.size < MAX_ASK_RESULT_WINDOWS) return;
  const oldestId = resultWindows.keys().next().value;
  if (oldestId === undefined) return;
  const entry = resultWindows.get(oldestId);
  resultWindows.delete(oldestId);
  if (entry && !entry.window.isDestroyed()) {
    entry.window.destroy();
  }
};

const createAskResultWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 420,
    minHeight: 280,
    show: false,
    skipTaskbar: true,
    title: buildAskResultWindowTitle(),
    webPreferences: {
      preload: path.join(app.getAppPath(), "out/preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachThemeSync(win);
  applyExternalNavigationGuard(win);

  // Electron's default behavior re-titles the native window from the loaded
  // document's <title> tag (a static, English-only fallback in index.html)
  // once it finishes parsing. Without this, that would silently clobber the
  // locale-aware title set above and by `syncAskResultWindowLocale`.
  win.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // Reset readiness when a load starts so DevTools reloads wait for a new
  // handshake instead of pushing into a listener that no longer exists.
  win.webContents.on("did-start-loading", () => {
    const entry = resultWindows.get(win.id);
    if (entry) entry.ready = false;
  });

  // Deliberately no `close` handler here: unlike the correction singleton,
  // this window is meant to be destroyed on close (see file header).
  win.on("closed", () => {
    resultWindows.delete(win.id);
  });

  const html = path.join(__dirname, "../renderer/AskResultWindow/index.html");
  void win.loadFile(html);
  return win;
};

/**
 * Opens a new Ask result popup near the cursor with the given payload,
 * cascading its position so stacked popups don't fully overlap. Evicts the
 * oldest open popup first if already at the 5-window cap.
 */
export const showAskResultWindow = (payload: AskResultPayload): void => {
  evictOldestIfAtCapacity();

  const win = createAskResultWindow();
  const cascadeIndex = findLowestFreeCascadeIndex();
  resultWindows.set(win.id, {
    window: win,
    payload,
    ready: false,
    cascadeIndex,
  });

  const cursor = screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(cursor).workArea;
  const { x, y } = clampToWorkArea({
    cursor,
    workArea,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    index: cascadeIndex,
  });

  win.setPosition(x, y, false);
};

/**
 * Retitles every currently-open Ask result window to the current locale,
 * skipping any that have already been destroyed. Mirrors
 * `syncCorrectionResultWindowLocale`, generalised to a multi-instance window.
 */
export const syncAskResultWindowLocale = (): void => {
  const title = buildAskResultWindowTitle();
  resultWindows.forEach((entry) => {
    if (!entry.window.isDestroyed()) {
      entry.window.setTitle(title);
    }
  });
};

ipcMain.on("ask-result-ready", (event) => {
  const entry = findEntryForSender(event.sender);
  if (!entry) return;
  entry.ready = true;
  revealWindow(entry);
});

ipcMain.on("close-ask-result-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

app.on("before-quit", () => {
  resultWindows.forEach((entry) => {
    if (!entry.window.isDestroyed()) {
      entry.window.removeAllListeners("close");
      entry.window.destroy();
    }
  });
  resultWindows.clear();
});
