/**
 * @file overlayWindow.test.ts
 * @description Covers card 04's slice of the combo overlay (plan O1-O5):
 * the window grows to a single fixed 28x28 / +10 size used for every mode
 * (O2 — no per-mode `setSize`, since that would race the 60Hz `setPosition`
 * tracking loop), and `updateComboProgress` ships exactly one
 * `executeJavaScript` per step boundary carrying `buildComboProgressStyle`'s
 * output verbatim (O5). Electron and the `?asset` import are mocked the same
 * way `promptGenWindow.test.ts` mocks them — this never boots a real window.
 * Static top-level imports (not `vi.resetModules()` + dynamic `import()`)
 * because Vite's `?asset` loader only honors `vi.mock` on the module graph
 * built from the static import graph; `destroyOverlayWindow()` resets the
 * singleton between tests instead.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildComboProgressStyle, type ComboProgressView } from "./comboProgressView";
import {
  createOverlayWindow,
  destroyOverlayWindow,
  showOverlaySpinner,
  updateComboProgress,
} from "./overlayWindow";

vi.mock("./overlay.html?asset", () => ({ default: "overlay.html" }));

vi.mock("~/features/theme/store/themeStore", () => ({
  themeStore: { getThemeId: vi.fn(() => "default") },
}));

vi.mock("~/features/appearance/store/appearanceStore", () => ({
  appearanceStore: {
    getTypography: vi.fn(() => ({ fontSize: "md", fontFamily: "system" })),
  },
}));

class BrowserWindowMock {
  setVisibleOnAllWorkspaces = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  loadFile = vi.fn();
  on = vi.fn();
  once = vi.fn();
  showInactive = vi.fn();
  hide = vi.fn();
  setPosition = vi.fn();
  setSize = vi.fn();
  isVisible = vi.fn(() => true);
  isDestroyed = vi.fn(() => false);
  destroy = vi.fn();
  webContents = {
    on: vi.fn(),
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    isDestroyed: vi.fn(() => false),
  };
}

let lastWindow: BrowserWindowMock | null = null;

// Invokes the `did-finish-load` handler `createOverlayWindow` registered on
// `webContents.on`, the same event overlayWindow.ts uses to flip
// `overlayReady` — simulates the renderer finishing its load.
const fireDidFinishLoad = () => {
  const call = lastWindow?.webContents.on.mock.calls.find(
    ([event]) => event === "did-finish-load",
  );
  (call?.[1] as (() => void) | undefined)?.();
};

const electronMocks = vi.hoisted(() => ({
  browserWindowCtor: vi.fn(),
  getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
}));

vi.mock("electron", () => ({
  BrowserWindow: electronMocks.browserWindowCtor,
  screen: { getCursorScreenPoint: electronMocks.getCursorScreenPoint },
  app: { whenReady: vi.fn(() => Promise.resolve()), on: vi.fn() },
}));

describe("overlayWindow — O2 fixed 28x28 / +10 size for every mode", () => {
  beforeEach(() => {
    destroyOverlayWindow();
    lastWindow = null;
    vi.clearAllMocks();
    electronMocks.browserWindowCtor.mockImplementation(function BrowserWindowCtor() {
      lastWindow = new BrowserWindowMock();
      return lastWindow;
    });
    electronMocks.getCursorScreenPoint.mockReturnValue({ x: 100, y: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates the overlay window at 28x28, not the old 20x20 spinner-only size", () => {
    createOverlayWindow();

    expect(electronMocks.browserWindowCtor).toHaveBeenCalledWith(
      expect.objectContaining({ width: 28, height: 28 }),
    );
  });

  it("tracks the cursor at a fixed +10 offset, the same for the plain spinner as for a combo run", () => {
    vi.useFakeTimers();
    createOverlayWindow();

    showOverlaySpinner();
    vi.advanceTimersByTime(1000 / 60);

    expect(lastWindow?.setPosition).toHaveBeenCalledWith(110, 110, false);
  });

  it("does not resize the window when showing the spinner (no per-mode setSize)", () => {
    createOverlayWindow();

    showOverlaySpinner();

    expect(lastWindow?.setSize).not.toHaveBeenCalled();
  });

  it("resets a leftover combo ring mode before showing the plain spinner again", () => {
    createOverlayWindow();

    showOverlaySpinner();

    expect(lastWindow?.webContents.executeJavaScript).toHaveBeenCalledWith(
      `document.body.dataset.overlayMode = ""`,
    );
  });
});

describe("updateComboProgress — one executeJavaScript per step boundary (O5)", () => {
  beforeEach(() => {
    destroyOverlayWindow();
    lastWindow = null;
    vi.clearAllMocks();
    electronMocks.browserWindowCtor.mockImplementation(function BrowserWindowCtor() {
      lastWindow = new BrowserWindowMock();
      return lastWindow;
    });
  });

  const VIEW: ComboProgressView = { total: 3, completed: 1, current: 2, state: "running" };

  it("sends exactly one executeJavaScript call whose payload is JSON.stringify of the pure module's output", () => {
    createOverlayWindow();
    fireDidFinishLoad();
    vi.clearAllMocks();

    updateComboProgress(VIEW);

    const expectedStyle = buildComboProgressStyle(VIEW);
    expect(lastWindow?.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(lastWindow?.webContents.executeJavaScript).toHaveBeenCalledWith(
      `window.__setComboProgress(${JSON.stringify(expectedStyle)})`,
    );
  });

  it("calls executeJavaScript again on the next step boundary, still once per call", () => {
    createOverlayWindow();
    fireDidFinishLoad();
    vi.clearAllMocks();

    updateComboProgress(VIEW);
    updateComboProgress({ ...VIEW, completed: 2, current: 3 });

    expect(lastWindow?.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when no overlay window has been created yet", () => {
    expect(() => updateComboProgress(VIEW)).not.toThrow();
    expect(lastWindow).toBeNull();
  });

  it("is a no-op against a destroyed window", () => {
    createOverlayWindow();
    fireDidFinishLoad();
    vi.clearAllMocks();
    lastWindow?.isDestroyed.mockReturnValue(true);

    updateComboProgress(VIEW);

    expect(lastWindow?.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it("is a no-op against a window that has not finished loading yet — a progress update landing in the startup race before window.__setComboProgress exists must not call executeJavaScript, and therefore cannot produce an unhandled rejection that would surface as a FATAL error notification", () => {
    createOverlayWindow();
    // Deliberately do NOT fire did-finish-load: this is the narrow window
    // between createOverlayWindow() and the renderer actually loading
    // overlay.html, where `window.__setComboProgress` does not exist yet.
    vi.clearAllMocks();

    updateComboProgress(VIEW);

    expect(lastWindow?.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it("swallows an executeJavaScript rejection instead of leaving it unhandled", async () => {
    createOverlayWindow();
    fireDidFinishLoad();
    vi.clearAllMocks();
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    lastWindow?.webContents.executeJavaScript.mockRejectedValueOnce(
      new ReferenceError("window.__setComboProgress is not a function"),
    );

    let unhandledRejection: unknown;
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejection = reason;
    };
    process.on("unhandledRejection", onUnhandledRejection);

    updateComboProgress(VIEW);
    // Flush the rejected promise's microtask queue so a real unhandled
    // rejection (if the fix regressed) would have a chance to fire.
    await new Promise((resolve) => setImmediate(resolve));

    process.off("unhandledRejection", onUnhandledRejection);
    expect(unhandledRejection).toBeUndefined();
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("does not resize the window on the combo-ring path either (no per-mode setSize)", () => {
    createOverlayWindow();
    fireDidFinishLoad();
    vi.clearAllMocks();

    updateComboProgress(VIEW);

    expect(lastWindow?.setSize).not.toHaveBeenCalled();
  });

  it("forwards a cancelling view through to the pure module unchanged, for the overlay to render as dimmed", () => {
    createOverlayWindow();
    fireDidFinishLoad();
    vi.clearAllMocks();
    const cancelling: ComboProgressView = { ...VIEW, state: "cancelling" };

    updateComboProgress(cancelling);

    const expectedStyle = buildComboProgressStyle(cancelling);
    expect(expectedStyle.animate).toBe(false);
    expect(lastWindow?.webContents.executeJavaScript).toHaveBeenCalledWith(
      `window.__setComboProgress(${JSON.stringify(expectedStyle)})`,
    );
  });
});

/**
 * `vi.mock("./overlay.html?asset", ...)` above removes the real asset from
 * every other describe block in this file — none of them can see what
 * `window.__setComboProgress` actually does. This block reads `overlay.html`
 * straight off disk (unaffected by the Vite `?asset` mock, same as
 * `profileChange.test.ts`'s "no main-process file broadcasts
 * ACTIVE_PROFILE_CHANGED directly" guard reads main-process source text) to
 * pin O5: the applier assigns the payload's `vars`/`digit`/`animate`
 * verbatim and computes no geometry of its own. A lens mutation moved
 * `--seg-deg` math into this script instead of reading it off `style.vars`
 * and the suite stayed green 11/11 — these checks exist to catch exactly
 * that.
 */
describe("overlay.html — window.__setComboProgress stays a pure applier (O5)", () => {
  let comboProgressScript: string;

  beforeEach(async () => {
    const overlayHtmlPath = join(
      process.cwd(),
      "src/main/webViewWindows/overlay.html",
    );
    const html = await readFile(overlayHtmlPath, "utf8");
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      throw new Error("overlay.html has no <script> tag to inspect");
    }
    comboProgressScript = scriptMatch[1];
    expect(comboProgressScript).toContain("window.__setComboProgress");
  });

  it("reads only vars, digit and animate off the payload — nothing else", () => {
    // Excludes `ring.style.setProperty` (a DOM CSSStyleDeclaration, not the
    // payload) by requiring `style.` not be preceded by another identifier
    // character or dot.
    const payloadProperties = [
      ...comboProgressScript.matchAll(/(?<![\w.])style\.(\w+)/g),
    ].map(([, property]) => property);

    expect(payloadProperties.length).toBeGreaterThan(0);
    expect(new Set(payloadProperties)).toEqual(new Set(["vars", "digit", "animate"]));
  });

  it("never builds a full-circle constant (360) — that math belongs to buildComboProgressStyle", () => {
    expect(comboProgressScript).not.toContain("360");
  });

  it("never constructs a calc( ) expression from JS — CSS custom properties carry the ready-made values", () => {
    expect(comboProgressScript).not.toContain("calc(");
  });

  it("never builds a `deg` angle string — degree units live only in overlay.html's CSS, never in this script", () => {
    expect(comboProgressScript).not.toContain("deg");
  });

  it("never divides by a segment total — that quotient is buildComboProgressStyle's job, not the applier's", () => {
    expect(comboProgressScript).not.toMatch(/\/\s*(?:style\.)?total\b/i);
  });
});


describe("overlay.html — combo ring mask geometry", () => {
  let overlayCss: string;

  beforeEach(async () => {
    const overlayHtmlPath = join(
      process.cwd(),
      "src/main/webViewWindows/overlay.html",
    );
    const html = await readFile(overlayHtmlPath, "utf8");
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    if (!styleMatch) {
      throw new Error("overlay.html has no <style> block to inspect");
    }
    overlayCss = styleMatch[1];
  });

  it("uses closest-side radial mask so ring thickness tracks --border-width", () => {
    expect(overlayCss).toContain(
      "radial-gradient(circle closest-side, transparent calc(100% - var(--border-width)), #000 calc(100% - var(--border-width)))",
    );
  });

  it("derives standalone text sizes from --font-size-base", () => {
    expect(overlayCss).toContain("font-size: var(--font-size-base, 14px);");
    expect(overlayCss).toContain(
      "font-size: calc(var(--font-size-base, 14px) * 12 / 14);",
    );
  });
});

