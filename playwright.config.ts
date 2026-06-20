/**
 * Playwright configuration for Electron visual-regression tests.
 *
 * Runs separately from Vitest — use `bun run test:e2e` to invoke.
 * Vitest (`bun run test`) excludes the `e2e/` directory and is unaffected.
 *
 * Requirements before running:
 *   1. Build the app:  bun run build
 *   2. Run the tests:  bun run test:e2e
 *
 * Screenshot baselines are stored in e2e/__screenshots__ and committed to git.
 * To update a baseline: bun run test:e2e --update-snapshots
 */
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

// ESM-safe __dirname equivalent (package.json has "type": "module")
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  testDir: "./e2e",
  // Isolate from Vitest — Playwright has its own runner
  timeout: 60_000,
  retries: 0,
  workers: 1, // Electron tests must run serially (single app instance)
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // Screenshot comparison settings for stability
    screenshot: "on",
  },
  snapshotDir: path.join(__dirname, "e2e", "__screenshots__"),
  // Update baseline: bun run test:e2e --update-snapshots
  updateSnapshots: "missing",
  expect: {
    toHaveScreenshot: {
      // Allow 1px threshold to handle sub-pixel antialiasing differences
      maxDiffPixels: 20,
      // Stable viewport — disable CSS animations before capture (done in test)
      animations: "disabled",
    },
  },
});
