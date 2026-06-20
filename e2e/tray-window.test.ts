/**
 * Tray window screenshot baseline test.
 *
 * Launches the Electron app and captures the tray window
 * (width ~300, height ~600) for visual-regression tracking.
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
 */
import path from "path";
import { fileURLToPath } from "url";
import { _electron as electron } from "playwright";
import { test, expect } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIN_JS = path.resolve(__dirname, "../out/main/index.js");

// Tray window declared as 300×600 in tray.ts. innerWidth/Height excludes OS chrome.
// Use generous thresholds: ≥200px wide AND < 600px wide (well below main's 990px).
const TRAY_WINDOW_MIN_WIDTH = 200;
const TRAY_WINDOW_MAX_WIDTH = 600;
const TRAY_WINDOW_MIN_HEIGHT = 400;

test.setTimeout(60_000);

test("tray window renders without crashing and matches screenshot", async () => {
  const app = await electron.launch({
    args: [MAIN_JS],
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Skip the blocking accessibility-permission dialog (dialog.showMessageBoxSync)
      // so Playwright can receive window events without startup being stalled.
      FIXLANG_E2E: "1",
    },
  });

  try {
    // Wait for at least one window to appear
    await app.firstWindow();

    // Allow all windows (overlay, tray, main) to initialise
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // Select tray window by its unique small dimensions.
    //
    // Window inventory when app starts:
    //   overlayWindow — 20×20 (hidden frameless spinner)
    //   trayWindow    — ~300px wide (show:false initially; FIXLANG_E2E makes it visible)
    //   mainWindow    — 1000×900 (the big React UI)
    //
    // We identify tray by: width is in [200, 600) AND height ≥ 400.
    // This cleanly separates it from the 20×20 overlay and 1000×900 main window.
    const allWindows = app.windows();
    let trayWindow = null;

    for (const win of allWindows) {
      const size = await win
        .evaluate(
          (): { width: number; height: number } => ({
            width: window.innerWidth,
            height: window.innerHeight,
          })
        )
        .catch(() => ({ width: 0, height: 0 }));

      if (
        size.width >= TRAY_WINDOW_MIN_WIDTH &&
        size.width < TRAY_WINDOW_MAX_WIDTH &&
        size.height >= TRAY_WINDOW_MIN_HEIGHT
      ) {
        trayWindow = win;
        break;
      }
    }

    if (trayWindow === null) {
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
        `Could not find tray window (need ${TRAY_WINDOW_MIN_WIDTH}–${TRAY_WINDOW_MAX_WIDTH}px wide, ≥${TRAY_WINDOW_MIN_HEIGHT}px tall). ` +
          `Found windows with sizes: [${sizes.join(", ")}]. ` +
          `Run 'bun run build' first, then retry.`
      );
    }

    await trayWindow.waitForLoadState("domcontentloaded");

    // Kill CSS animations/transitions for pixel-stable captures
    await trayWindow.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });

    // Brief pause for JS-driven layout to settle
    await trayWindow.waitForTimeout(300);

    // Verify we have a tray-sized window before snapping
    const finalSize = await trayWindow.evaluate(
      (): { width: number; height: number } => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
    expect(
      finalSize.width,
      `Tray window width must be ≥${TRAY_WINDOW_MIN_WIDTH}px and <${TRAY_WINDOW_MAX_WIDTH}px (got ${finalSize.width})`
    ).toBeGreaterThanOrEqual(TRAY_WINDOW_MIN_WIDTH);
    expect(
      finalSize.width,
      `Tray window width must be <${TRAY_WINDOW_MAX_WIDTH}px (got ${finalSize.width})`
    ).toBeLessThan(TRAY_WINDOW_MAX_WIDTH);

    // Capture and compare against stored baseline
    await expect(trayWindow).toHaveScreenshot("tray-window.png");
  } finally {
    await app.close();
  }
});
