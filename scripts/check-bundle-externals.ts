/**
 * @file check-bundle-externals.ts
 * @description Bun-runnable guardrail CLI. Runs the bundle-externals scanner
 * in `src/shared/bundleExternals.ts` against the real `out/` build output and
 * exits non-zero if any built bundle would resolve a module from
 * `node_modules` at runtime — which the packaged app no longer ships.
 *
 * No `import.meta.main`-style entry guard on purpose: this file is a CLI only,
 * nothing imports it (the tests target `src/shared/bundleExternals.ts`), and
 * the previous guard compared a percent-encoded `import.meta.url` against a
 * raw `process.argv[1]`, so a checkout path containing a space silently
 * skipped the whole check and exited 0. Same shape as `scripts/i18n-check.ts`.
 *
 * Usage: bun run check:bundle   (run `bun run build` first)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOutDir, runBundleExternalsCheck } from "../src/shared/bundleExternals";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exitCode = runBundleExternalsCheck(resolveOutDir(scriptsDir));

if (exitCode !== 0) {
  process.exit(exitCode);
}
