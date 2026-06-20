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

// Resolve to the built main-process entry from the project root
const MAIN_JS = path.resolve(__dirname, "../out/main/index.js");

// Individual test timeout — Electron startup can take several seconds
test.setTimeout(60_000);

test("main window renders without crashing and matches screenshot", async () => {
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
    // Collect all windows that open; the main window title is "FixLang"
    // We wait for ANY window first, then find the largest one (main UI).
    const firstWin = await app.firstWindow();

    // Allow time for all windows to fully initialise
    await firstWin.waitForLoadState("domcontentloaded");

    // Pick the main window by checking all open windows for the largest one
    // (overlay and tray windows are small; main window is 1000x900)
    const allWindows = app.windows();
    let mainWindow = firstWin;
    for (const win of allWindows) {
      // evaluate runs in the renderer; we want the window with a full React root
      const hasRoot = await win
        .evaluate(() => document.querySelector("#root") !== null)
        .catch(() => false);
      if (hasRoot) {
        mainWindow = win;
        break;
      }
    }

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

    // Capture and compare against stored baseline
    await expect(mainWindow).toHaveScreenshot("main-window.png");
  } finally {
    await app.close();
  }
});
