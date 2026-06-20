/**
 * PromptGen window screenshot baseline — #32 dark restyle.
 *
 * The PromptGen window is not created at app startup — it is spawned lazily
 * on the first hotkey trigger. To capture it for a baseline we create a
 * BrowserWindow from the main-process context via app.evaluate(), load the
 * built PromptGen HTML, then select it by viewport size and wait for React to
 * mount before snapping.
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

// PromptGen window is declared as 1000×600 in promptGenWindow.ts.
// innerWidth/Height excludes OS titlebar chrome (~32px on macOS).
// Expected inner dimensions ≈ 1000 × 568.
//
// Distinguish from:
//   overlayWindow — 20×20 (spinner, hidden)
//   trayWindow    — ~300px wide, ~600px tall
//   mainWindow    — 1000×900 (innerHeight ≥ 800)
//
// PromptGen: width ≥ 990 AND innerHeight in [500, 800).
const PROMPTGEN_MIN_WIDTH = 990;
const PROMPTGEN_MIN_HEIGHT = 500;
const PROMPTGEN_MAX_HEIGHT = 800;

// Individual test timeout — Electron startup can take several seconds
test.setTimeout(60_000);

test(
  "promptgen window renders native dark restyle and matches screenshot",
  async () => {
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

      // Allow the app to finish initialising all startup windows
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      // Create and show the PromptGen window from the main-process context.
      // The window is not created at startup — it is spawned lazily on the
      // first hotkey trigger. We create it imperatively here for baseline capture.
      // We use BrowserWindow + loadFile rather than importing the app-internal
      // `createPromptGenWindow`, which avoids any IPC setup the real fn does.
      // Pass paths computed in the test (Node.js) context into the evaluate callback.
      // The main process runs in ESM mode — require() is unavailable.
      const preloadPath = path.join(PROJECT_ROOT, "out/preload/index.js");
      const htmlPath = path.join(
        PROJECT_ROOT,
        "out/renderer/PromptGenWindow/index.html"
      );

      await app.evaluate(
        ({ BrowserWindow }, { preloadPath: pload, htmlPath: html }) => {
          const win = new BrowserWindow({
            width: 1000,
            height: 600,
            show: false,
            skipTaskbar: true,
            backgroundColor: "#1e1e1e",
            titleBarStyle: "default",
            title: "Generated Prompts",
            frame: true,
            webPreferences: {
              preload: pload,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: false,
            },
          });
          win.loadFile(html);
          win.once("ready-to-show", () => {
            win.showInactive();
          });
        },
        { preloadPath, htmlPath }
      );

      // Give the new BrowserWindow time to load and appear
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));

      // Deterministically select the promptgen window by viewport size.
      //
      // Window inventory after evaluate():
      //   overlayWindow  — 20×20
      //   trayWindow     — ~300px wide, ~600px tall
      //   mainWindow     — 1000×~868
      //   promptgenWindow — 1000×~568  ← we want this
      const allWindows = app.windows();
      let promptgenWindow = null;

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
          size.width >= PROMPTGEN_MIN_WIDTH &&
          size.height >= PROMPTGEN_MIN_HEIGHT &&
          size.height < PROMPTGEN_MAX_HEIGHT
        ) {
          promptgenWindow = win;
          break;
        }
      }

      // Hard guard: fail loudly if the promptgen window was not found.
      if (promptgenWindow === null) {
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
          `Could not find promptgen window (need width≥${PROMPTGEN_MIN_WIDTH}, height ${PROMPTGEN_MIN_HEIGHT}–${PROMPTGEN_MAX_HEIGHT}). ` +
            `Found windows with sizes: [${sizes.join(", ")}]. ` +
            `Run 'bun run build' first, then retry.`
        );
      }

      await promptgenWindow.waitForLoadState("domcontentloaded");

      // Wait until React has mounted the PromptGenWindow component.
      // [data-testid="promptgen-window-root"] is present even when data is null
      // (empty state div). Without this wait the screenshot races domcontentloaded
      // and captures a blank #root.
      await promptgenWindow.waitForSelector(
        '[data-testid="promptgen-window-root"]',
        { state: "visible", timeout: 15_000 }
      );

      // Disable CSS animations/transitions for pixel-stable captures
      await promptgenWindow.addStyleTag({
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
      await promptgenWindow.waitForTimeout(300);

      // Final dimension assertions — fail loudly if wrong window was selected.
      const finalSize = await promptgenWindow.evaluate(
        (): { width: number; height: number } => ({
          width: window.innerWidth,
          height: window.innerHeight,
        })
      );
      expect(
        finalSize.width,
        `PromptGen window width must be ≥${PROMPTGEN_MIN_WIDTH}px (got ${finalSize.width})`
      ).toBeGreaterThanOrEqual(PROMPTGEN_MIN_WIDTH);
      expect(
        finalSize.height,
        `PromptGen window height must be ≥${PROMPTGEN_MIN_HEIGHT}px (got ${finalSize.height})`
      ).toBeGreaterThanOrEqual(PROMPTGEN_MIN_HEIGHT);
      expect(
        finalSize.height,
        `PromptGen window height must be <${PROMPTGEN_MAX_HEIGHT}px (got ${finalSize.height}) — main window selected instead`
      ).toBeLessThan(PROMPTGEN_MAX_HEIGHT);

      // Capture and compare against stored baseline
      await expect(promptgenWindow).toHaveScreenshot("promptgen-window.png");
    } finally {
      await app.close();
    }
  }
);
