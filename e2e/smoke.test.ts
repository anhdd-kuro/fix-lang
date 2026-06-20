/**
 * Smoke test: launches the real Electron app and screenshots the Main window.
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
 * The Electron app opens real BrowserWindows; Playwright _electron captures them directly.
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

// Expected dimensions of the main window (from mainWindow.ts: width:1000, height:900).
// window.innerWidth/Height excludes the OS titlebar chrome, so measured values are
// slightly smaller than the BrowserWindow constructor sizes. We use conservative
// thresholds that still clearly separate main (1000×~868) from tray (~300×600)
// and overlay (20×20).
const MAIN_WINDOW_MIN_WIDTH = 990;
const MAIN_WINDOW_MIN_HEIGHT = 800;

// Individual test timeout — Electron startup can take several seconds
test.setTimeout(60_000);

test("main window renders without crashing and matches screenshot", async () => {
  const app = await electron.launch({
    args: [PROJECT_ROOT],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Skip the blocking accessibility-permission dialog (dialog.showMessageBoxSync)
      // so Playwright can receive window events without startup being stalled.
      FIXLANG_E2E: "1",
    },
  });

  try {
    // Wait for at least one window to exist
    await app.firstWindow();

    // Give the app a moment for all windows (overlay, tray, main) to initialise
    // before scanning. overlayWindow and trayWindow are created before main window
    // in whenReady(), so we wait for all of them to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // Deterministically select the main window by viewport size.
    //
    // Window inventory when app starts:
    //   overlayWindow — 20×20 (spinner, hidden, frameless)
    //   trayWindow    — small (~320px wide)
    //   mainWindow    — 1000×900 (the React UI we want to screenshot)
    //
    // Selecting by size is robust: no reliance on title strings, URL paths,
    // or #root existence (overlay.html also has no #root but could match falsely).
    const allWindows = app.windows();
    let mainWindow = null;

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
        size.width >= MAIN_WINDOW_MIN_WIDTH &&
        size.height >= MAIN_WINDOW_MIN_HEIGHT
      ) {
        mainWindow = win;
        break;
      }
    }

    // Hard guard: fail loudly if no 1000×900 window was found.
    // This prevents a wrong (tiny) baseline from being silently committed.
    if (mainWindow === null) {
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
        `Could not find main window (need ≥${MAIN_WINDOW_MIN_WIDTH}×${MAIN_WINDOW_MIN_HEIGHT}). ` +
          `Found windows with sizes: [${sizes.join(", ")}]. ` +
          `Run 'bun run build' first, then retry.`
      );
    }

    await mainWindow.waitForLoadState("domcontentloaded");

    // Wait until React has actually rendered the MainWindow App.
    // [data-testid="main-window-root"] is the root div of App.tsx — it only
    // exists once React mounts. Without this wait the screenshot races
    // domcontentloaded and captures a blank-white #root.
    await mainWindow.waitForSelector('[data-testid="main-window-root"]', {
      state: "visible",
      timeout: 15_000,
    });

    // Disable CSS animations/transitions for pixel-stable captures
    await mainWindow.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });

    // Brief pause for JS-driven layout to settle after animation kill
    await mainWindow.waitForTimeout(300);

    // Final dimension assertion — fails loudly before screenshot if something changed.
    // Uses the same thresholds as the selection step above.
    const finalSize = await mainWindow.evaluate(
      (): { width: number; height: number } => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
    expect(
      finalSize.width,
      `Main window width must be ≥${MAIN_WINDOW_MIN_WIDTH}px (got ${finalSize.width})`
    ).toBeGreaterThanOrEqual(MAIN_WINDOW_MIN_WIDTH);
    expect(
      finalSize.height,
      `Main window height must be ≥${MAIN_WINDOW_MIN_HEIGHT}px (got ${finalSize.height})`
    ).toBeGreaterThanOrEqual(MAIN_WINDOW_MIN_HEIGHT);

    // Capture and compare against stored baseline
    await expect(mainWindow).toHaveScreenshot("main-window.png");
  } finally {
    await app.close();
  }
});
