/**
 * @file externalNavigationGuard.ts
 * @description The one place a URL may leave a FixLang window, and the one
 * policy that decides whether it may.
 *
 * Every window in this app renders text it did not author: GitHub release
 * notes in the About panel, model output in the Ask AI result window, the
 * user's own selection in the Ask input window. The renderer routes clicked
 * links through the `open-external-link` bridge — but a React `onClick` is
 * bound to `click`, and a MIDDLE click fires `auxclick`, never `click`. That
 * click reaches Electron with no handler having run, and Electron's default
 * for an unhandled window-open is to ALLOW it: the target loads in a new
 * app-owned `BrowserWindow` with no address bar, so the user has no surface
 * on which to notice that the link text and the href disagreed. A plain
 * navigation nobody called `preventDefault()` on is worse still — it replaces
 * the app's own UI, inside the window that carries the preload.
 *
 * So: deny every window-open, block every top-level navigation away from the
 * loaded page, and hand the URL to `openExternalUrl` — the same scheme check
 * and the same `shell.openExternal` the IPC bridge uses, so there is exactly
 * one answer to "may this open, and where". Nothing in this app calls
 * `window.open` or uses `target="_blank"`, so denying costs no real behaviour.
 */
import { shell } from "electron";
import type { BrowserWindow } from "electron";

export type OpenExternalResult = Readonly<{
  success: boolean;
  error?: string;
}>;

const UNSUPPORTED_SCHEME_ERROR = "Unsupported URL scheme";

/**
 * Opens `url` in the user's real browser, where its true destination is
 * visible in an address bar, or refuses it. Only `http:`/`https:` pass —
 * `file:`, `javascript:` and `data:` reach `shell.openExternal` as a handoff
 * to whatever the OS has registered for them, which is not a thing a release
 * note or a model answer gets to decide.
 */
export const openExternalUrl = async (
  url: string,
): Promise<OpenExternalResult> => {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { success: false, error: UNSUPPORTED_SCHEME_ERROR };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { success: false, error: UNSUPPORTED_SCHEME_ERROR };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/**
 * Same document, different fragment or query — a reload, or the error popup's
 * `#dismiss` anchor. Chromium runs no navigation throttle for a same-document
 * navigation, so Electron should not emit `will-navigate` for one at all; this
 * says so explicitly rather than resting on that, because getting it wrong
 * would silently break a Close button.
 */
const isSamePage = (target: string, current: string): boolean => {
  try {
    const to = new URL(target);
    const from = new URL(current);
    return (
      to.protocol === from.protocol &&
      to.host === from.host &&
      to.pathname === from.pathname
    );
  } catch {
    return target === current;
  }
};

/**
 * Installs the deny-and-delegate policy on `win`. Called by every window
 * factory in this directory; `externalNavigationGuard.test.ts` fails if a
 * factory is added without it.
 */
export const applyExternalNavigationGuard = (win: BrowserWindow): void => {
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isSamePage(url, win.webContents.getURL())) return;
    event.preventDefault();
    void openExternalUrl(url);
  });
};
