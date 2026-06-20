/**
 * Translation window screenshot baseline test.
 *
 * The translation window is created with show:false and its HTML is loaded
 * on demand (via showTranslationWindow IPC). We use app.evaluate() to
 * imperatively load the HTML and show the window — the same approach used
 * by overlay.test.ts — so we can capture a stable baseline without triggering
 * real AI translation.
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

// Translation window declared as 500×350 in translationWindow.ts.
// innerWidth/Height excludes OS chrome. Use generous range that still
// clearly separates translation from:
//   overlayWindow — 20×20
//   trayWindow    — ~300px wide, ≥400px tall (excluded by height max)
//   mainWindow    — ≥990px wide (excluded by width max)
const TRANSLATION_WINDOW_MIN_WIDTH = 400;
const TRANSLATION_WINDOW_MAX_WIDTH = 600;
const TRANSLATION_WINDOW_MIN_HEIGHT = 280;
const TRANSLATION_WINDOW_MAX_HEIGHT = 400;

// Individual test timeout — Electron startup can take several seconds
test.setTimeout(60_000);

test("translation window renders dark restyle and matches screenshot", async () => {
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

    // Allow all windows (overlay, tray, main) to initialise before we
    // locate and show the translation window.
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // The translation window is created lazily (only when showTranslationWindow IPC
    // fires), so it does not exist in BrowserWindow.getAllWindows() at startup.
    // We create it imperatively via app.evaluate() — passing the resolved HTML
    // and preload paths as arguments to avoid require() inside the sandbox.
    //
    // We mirror the BrowserWindow config from translationWindow.ts exactly
    // (width:500, height:350, contextIsolation:true) so the screenshot shows
    // the real production layout at the correct size.
    const translationHtmlPath = path.join(
      PROJECT_ROOT,
      "out/renderer/TranslationWindow/index.html"
    );
    const preloadPath = path.join(PROJECT_ROOT, "out/preload/index.js");

    // Wait for the new window to appear in Playwright's tracking list
    const newWindowPromise = app.waitForEvent("window", { timeout: 15_000 });

    await app.evaluate(
      ({ BrowserWindow }, { htmlPath, preload }) => {
        const win = new BrowserWindow({
          width: 500,
          height: 350,
          show: false,
          frame: true,
          title: "Translation Result",
          webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
          },
        });
        win.loadFile(htmlPath);
        win.once("ready-to-show", () => {
          win.showInactive();
        });
      },
      { htmlPath: translationHtmlPath, preload: preloadPath }
    );

    // Wait for Playwright to track the new window
    const translationWindowFromEvent = await newWindowPromise;
    void translationWindowFromEvent; // captured below by size for consistency

    // Brief pause for React to mount after HTML load
    await new Promise<void>((resolve) => setTimeout(resolve, 800));

    // Deterministically select the translation window by its unique size.
    //
    // Window inventory when app starts:
    //   overlayWindow     — 20×20 (hidden frameless spinner)
    //   trayWindow        — ~300px wide, ~600px tall
    //   mainWindow        — ≥990px wide
    //   translationWindow — ~480px wide, ~320px tall ← we want this
    const allWindows = app.windows();
    let translationWindow = null;

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
        size.width >= TRANSLATION_WINDOW_MIN_WIDTH &&
        size.width <= TRANSLATION_WINDOW_MAX_WIDTH &&
        size.height >= TRANSLATION_WINDOW_MIN_HEIGHT &&
        size.height <= TRANSLATION_WINDOW_MAX_HEIGHT
      ) {
        translationWindow = win;
        break;
      }
    }

    // Hard guard: fail loudly if no translation-sized window was found.
    if (translationWindow === null) {
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
        `Could not find translation window ` +
          `(need ${TRANSLATION_WINDOW_MIN_WIDTH}–${TRANSLATION_WINDOW_MAX_WIDTH}px wide, ` +
          `${TRANSLATION_WINDOW_MIN_HEIGHT}–${TRANSLATION_WINDOW_MAX_HEIGHT}px tall). ` +
          `Found windows with sizes: [${sizes.join(", ")}]. ` +
          `Run 'bun run build' first, then retry.`
      );
    }

    await translationWindow.waitForLoadState("domcontentloaded");

    // Wait until React has actually rendered the TranslationWindow App.
    // [data-testid="translation-window-root"] is the root div of index.tsx —
    // it only exists once React mounts. Without this wait the screenshot races
    // domcontentloaded and captures a blank-white #root.
    await translationWindow.waitForSelector(
      '[data-testid="translation-window-root"]',
      {
        state: "visible",
        timeout: 15_000,
      }
    );

    // Disable CSS animations/transitions for pixel-stable captures
    await translationWindow.addStyleTag({
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
    await translationWindow.waitForTimeout(300);

    // Final dimension assertion — fails loudly before screenshot if wrong window selected
    const finalSize = await translationWindow.evaluate(
      (): { width: number; height: number } => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
    expect(
      finalSize.width,
      `Translation window width must be ≥${TRANSLATION_WINDOW_MIN_WIDTH}px (got ${finalSize.width})`
    ).toBeGreaterThanOrEqual(TRANSLATION_WINDOW_MIN_WIDTH);
    expect(
      finalSize.width,
      `Translation window width must be ≤${TRANSLATION_WINDOW_MAX_WIDTH}px (got ${finalSize.width})`
    ).toBeLessThanOrEqual(TRANSLATION_WINDOW_MAX_WIDTH);
    expect(
      finalSize.height,
      `Translation window height must be ≥${TRANSLATION_WINDOW_MIN_HEIGHT}px (got ${finalSize.height})`
    ).toBeGreaterThanOrEqual(TRANSLATION_WINDOW_MIN_HEIGHT);
    expect(
      finalSize.height,
      `Translation window height must be ≤${TRANSLATION_WINDOW_MAX_HEIGHT}px (got ${finalSize.height})`
    ).toBeLessThanOrEqual(TRANSLATION_WINDOW_MAX_HEIGHT);

    // Capture and compare against stored baseline
    await expect(translationWindow).toHaveScreenshot("translation-window.png");
  } finally {
    await app.close();
  }
});
