/**
 * Overlay window screenshot baseline — Summary/spinner window (#33).
 *
 * overlay.html is raw HTML (no Tailwind/@theme). This test verifies its
 * native dark restyle by capturing a screenshot baseline of the 20×20
 * spinner window with CSS animations frozen.
 *
 * Prerequisites (run once before this suite):
 *   bun run build
 *
 * Run:
 *   bun run test:e2e
 *
 * Update baseline:
 *   bun run test:e2e --update-snapshots
 *
 * Baselines are stored in e2e/__screenshots__ and committed to git.
 *
 * NOTE: This test requires a macOS display and must be run locally (not headless CI).
 */
import path from "path";
import { fileURLToPath } from "url";
import { _electron as electron } from "playwright";
import { test, expect } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Launch via the project root so Electron reads package.json and sets
// app.getAppPath() → PROJECT_ROOT. The production code constructs the preload
// path as path.join(app.getAppPath(), "out/preload/index.js"), which is only
// correct when getAppPath() returns the project root — not the out/main/
// directory that results from passing the .js entry directly.
const PROJECT_ROOT = path.resolve(__dirname, "..");

// The overlay BrowserWindow is created at exactly 20×20.
// We guard against capturing a wrong window by requiring the found window
// dimensions are no larger than this ceiling (with a small margin for rounding).
const OVERLAY_MAX_WIDTH = 30;
const OVERLAY_MAX_HEIGHT = 30;

// Individual test timeout — Electron startup can take several seconds
test.setTimeout(60_000);

test("overlay window renders native dark restyle and matches screenshot", async () => {
  const app = await electron.launch({
    args: [PROJECT_ROOT],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Skip the blocking accessibility-permission dialog so Playwright can
      // receive window events without startup being stalled.
      FIXLANG_E2E: "1",
    },
  });

  try {
    // Wait for at least one window to exist
    await app.firstWindow();

    // Give the app time for all windows (overlay, tray, main) to initialise.
    // overlayWindow is created in app.whenReady() before mainWindow.
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // Show the overlay window from the main process so it is visible for capture.
    // We access the BrowserWindow list via electron's main-process context.
    // This is the only way to imperatively show a hidden, focusable:false window
    // without IPC (the overlay has nodeIntegration:false + no preload).
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        const bounds = win.getBounds();
        if (bounds.width <= 30 && bounds.height <= 30) {
          win.showInactive();
          break;
        }
      }
    });

    // Brief pause for the window to actually appear on screen
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // Deterministically select the overlay window by its tiny 20×20 viewport.
    //
    // Window inventory when app starts:
    //   overlayWindow — 20×20 (spinner, frameless, transparent) ← we want this
    //   trayWindow    — small (~300px wide)
    //   mainWindow    — 1000×900
    //
    // Selecting by size ceiling (≤30px) is robust and avoids any reliance on
    // title strings or URL paths. This is the approach used in smoke.test.ts
    // but inverted: we want the SMALLEST window, not the largest.
    const allWindows = app.windows();
    let overlayWindow = null;

    for (const win of allWindows) {
      const size = await win
        .evaluate(
          (): { width: number; height: number } => ({
            width: window.innerWidth,
            height: window.innerHeight,
          })
        )
        .catch(() => ({ width: 9999, height: 9999 }));

      if (size.width <= OVERLAY_MAX_WIDTH && size.height <= OVERLAY_MAX_HEIGHT) {
        overlayWindow = win;
        break;
      }
    }

    // Hard guard: fail loudly if no 20×20 window was found.
    // Prevents a wrong (large) baseline from being silently committed.
    // This mirrors the guard in smoke.test.ts and addresses the "wrong tiny window"
    // failure mode described in the #27 harness notes (here the failure is inverted:
    // we'd accidentally capture a larger window).
    if (overlayWindow === null) {
      const sizes = await Promise.all(
        allWindows.map((w) =>
          w
            .evaluate(
              (): string => `${window.innerWidth}x${window.innerHeight}`
            )
            .catch(() => "error")
        )
      );
      throw new Error(
        `Could not find overlay window (need ≤${OVERLAY_MAX_WIDTH}×${OVERLAY_MAX_HEIGHT}). ` +
          `Found windows with sizes: [${sizes.join(", ")}]. ` +
          `Run 'bun run build' first, then retry.`
      );
    }

    await overlayWindow.waitForLoadState("domcontentloaded");

    // Disable CSS animations/transitions for pixel-stable captures.
    // The prixClipFix keyframe animation in overlay.html would otherwise make
    // every snapshot non-deterministic.
    await overlayWindow.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });

    // Brief pause for layout to settle after animation kill
    await overlayWindow.waitForTimeout(300);

    // Final dimension assertion — fails loudly before screenshot if something changed.
    // Upper bound: not a main window accidentally selected.
    const finalSize = await overlayWindow.evaluate(
      (): { width: number; height: number } => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
    expect(
      finalSize.width,
      `Overlay window width must be ≤${OVERLAY_MAX_WIDTH}px (got ${finalSize.width}) — wrong window selected`
    ).toBeLessThanOrEqual(OVERLAY_MAX_WIDTH);
    expect(
      finalSize.height,
      `Overlay window height must be ≤${OVERLAY_MAX_HEIGHT}px (got ${finalSize.height}) — wrong window selected`
    ).toBeLessThanOrEqual(OVERLAY_MAX_HEIGHT);

    // Capture and compare against stored baseline
    await expect(overlayWindow).toHaveScreenshot("overlay-window.png");
  } finally {
    await app.close();
  }
});
