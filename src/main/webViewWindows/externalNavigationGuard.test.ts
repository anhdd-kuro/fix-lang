/**
 * @file externalNavigationGuard.test.ts
 * @description Pins the deny-and-delegate policy AND its coverage.
 *
 * The behaviour half asserts what the handler does with a URL. The coverage
 * half reads every window factory in this directory off disk and fails when
 * one constructs a `BrowserWindow` without installing the guard — because the
 * defect this fixes was not a wrong handler, it was no handler anywhere, and a
 * per-factory assertion is the only kind that a NEW factory can fail.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyExternalNavigationGuard,
  openExternalUrl,
} from "./externalNavigationGuard";
import type { BrowserWindow } from "electron";

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve()),
}));

vi.mock("electron", () => ({
  shell: { openExternal: electronMocks.openExternal },
}));

type WindowOpenHandler = (details: { url: string }) => { action: string };
type NavigationListener = (
  event: { preventDefault: () => void },
  url: string,
) => void;

const CURRENT_URL = "file:///app/out/renderer/MainWindow/index.html";

const createWindow = () => {
  const listeners = new Map<string, NavigationListener>();
  let windowOpenHandler: WindowOpenHandler | undefined;
  const win = {
    webContents: {
      setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
        windowOpenHandler = handler;
      }),
      on: vi.fn((event: string, listener: NavigationListener) => {
        listeners.set(event, listener);
      }),
      getURL: vi.fn(() => CURRENT_URL),
    },
  };
  return {
    win: win as unknown as BrowserWindow,
    openWindow: (url: string) => {
      if (!windowOpenHandler) throw new Error("no window-open handler installed");
      return windowOpenHandler({ url });
    },
    navigate: (url: string) => {
      const listener = listeners.get("will-navigate");
      if (!listener) throw new Error("no will-navigate listener installed");
      const preventDefault = vi.fn();
      listener({ preventDefault }, url);
      return preventDefault;
    },
  };
};

describe("openExternalUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens an http(s) URL in the user's own browser", async () => {
    await expect(openExternalUrl("https://example.com/notes")).resolves.toEqual({
      success: true,
    });
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      "https://example.com/notes",
    );
  });

  it.each(["file:///etc/hosts", "javascript:alert(1)", "data:text/html,<b>", "not a url"])(
    "refuses %s without handing it to the OS",
    async (url) => {
      await expect(openExternalUrl(url)).resolves.toEqual({
        success: false,
        error: "Unsupported URL scheme",
      });
      expect(electronMocks.openExternal).not.toHaveBeenCalled();
    },
  );

  it("reports a failing shell handoff instead of throwing", async () => {
    electronMocks.openExternal.mockRejectedValueOnce(new Error("no handler"));

    await expect(openExternalUrl("https://example.com")).resolves.toEqual({
      success: false,
      error: "no handler",
    });
  });
});

describe("applyExternalNavigationGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies a window-open and opens the target in the real browser instead", () => {
    const { win, openWindow } = createWindow();
    applyExternalNavigationGuard(win);

    // What a middle-click on a release-notes link reaches main as.
    expect(openWindow("https://evil.example.com/phish")).toEqual({
      action: "deny",
    });
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      "https://evil.example.com/phish",
    );
  });

  it("still denies a window-open whose URL is not externally openable", () => {
    const { win, openWindow } = createWindow();
    applyExternalNavigationGuard(win);

    expect(openWindow("file:///etc/hosts")).toEqual({ action: "deny" });
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });

  it("blocks a top-level navigation away from the app and delegates it", () => {
    const { win, navigate } = createWindow();
    applyExternalNavigationGuard(win);

    const preventDefault = navigate("https://evil.example.com/phish");

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      "https://evil.example.com/phish",
    );
  });

  it("leaves a reload of the page already loaded alone", () => {
    const { win, navigate } = createWindow();
    applyExternalNavigationGuard(win);

    const preventDefault = navigate(CURRENT_URL);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });

  it("leaves a fragment change on the loaded page alone — that is the error popup's Close button", () => {
    const { win, navigate } = createWindow();
    applyExternalNavigationGuard(win);

    const preventDefault = navigate(`${CURRENT_URL}#fixlang-error-dismiss`);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });

  it("still blocks a different local page, not just remote ones", () => {
    const { win, navigate } = createWindow();
    applyExternalNavigationGuard(win);

    const preventDefault = navigate("file:///etc/passwd");

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });
});

describe("every window factory installs the guard", () => {
  const sourceRoot = path.resolve(__dirname, "../..");

  /** Every non-test source file that constructs a real `BrowserWindow`. */
  const factories = readdirSync(sourceRoot, {
    recursive: true,
    encoding: "utf8",
  })
    .filter(
      (name) =>
        (name.endsWith(".ts") || name.endsWith(".tsx")) &&
        !name.endsWith(".test.ts") &&
        !name.endsWith(".test.tsx"),
    )
    .filter((name) =>
      readFileSync(path.join(sourceRoot, name), "utf8").includes(
        "new BrowserWindow(",
      ),
    )
    .map((name) => name.split(path.sep).join("/"))
    .sort();

  it("finds every window factory in src/, not just the ones in this directory", () => {
    // A window created OUTSIDE this directory would silently drop out of the
    // per-factory check below, so the location is pinned too.
    expect(factories).toEqual([
      "main/webViewWindows/askInputWindow.ts",
      "main/webViewWindows/askResultWindow.ts",
      "main/webViewWindows/correctionResultWindow.ts",
      "main/webViewWindows/errorPopupWindow.ts",
      "main/webViewWindows/mainWindow.ts",
      "main/webViewWindows/overlayWindow.ts",
      "main/webViewWindows/promptGenWindow.ts",
      "main/webViewWindows/tray.ts",
    ]);
  });

  it.each(factories)("%s calls applyExternalNavigationGuard", (name) => {
    const source = readFileSync(path.join(sourceRoot, name), "utf8");

    // Compared as a flag rather than with `toContain`, so a failure prints the
    // file name instead of the whole window factory.
    expect({
      file: name,
      installsGuard: source.includes("applyExternalNavigationGuard("),
    }).toEqual({ file: name, installsGuard: true });
  });
});
