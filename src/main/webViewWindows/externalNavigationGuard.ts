/**
 * The one place a URL may leave a FixLang window. These windows render text
 * they did not author (release notes, model output), and a link's React
 * `onClick` is bound to `click` — a MIDDLE click fires `auxclick`, so no
 * handler runs and Electron's default for an unhandled window-open is to
 * ALLOW it into a chrome-less app-owned window with no address bar. So: deny
 * every window-open, preventDefault every cross-document navigation, and
 * delegate to `openExternalUrl`.
 */
import { shell } from "electron";
import type { BrowserWindow } from "electron";

export type OpenExternalResult = Readonly<{
  success: boolean;
  error?: string;
}>;

const UNSUPPORTED_SCHEME_ERROR = "Unsupported URL scheme";

/**
 * http/https only: `shell.openExternal` would otherwise hand `file:`,
 * `javascript:` or `data:` to whatever the OS registered for them.
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
 * A reload, or the error popup's `#dismiss` anchor. Electron should not emit
 * `will-navigate` for a same-document navigation at all, but a Close button
 * rests on this rather than on that.
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

/** Every factory in this directory must install this; its test enforces that. */
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
