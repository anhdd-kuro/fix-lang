/**
 * @file check-bundle-externals.ts
 * @description Bun-runnable guardrail CLI. Runs the bundle-externals scanner
 * in `src/features/core/shared/bundleExternals.ts` against the real `out/` build output and
 * exits non-zero if any built bundle would resolve a module from
 * `node_modules` at runtime — which the packaged app no longer ships.
 *
 * No `import.meta.main`-style entry guard on purpose: this file is a CLI only,
 * nothing imports it (the tests target `src/features/core/shared/bundleExternals.ts`), and
 * the previous guard compared a percent-encoded `import.meta.url` against a
 * raw `process.argv[1]`, so a checkout path containing a space silently
 * skipped the whole check and exited 0. Same shape as `scripts/i18n-check.ts`.
 *
 * Usage: bun run check:bundle   (run `bun run build` first)
 *        bun run scripts/check-bundle-externals.ts <outDir>
 *
 * The optional <outDir> argument exists so the integration test can drive this
 * exact file under `bun`, the runtime that actually runs it in CI. That is not
 * a redundant belt over the unit tests: vitest transpiles with esbuild and bun
 * with its own TypeScript parser, and the two do not always agree.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOutDir, runBundleExternalsCheck } from "../src/features/core/shared/bundleExternals";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const outDirArg = process.argv[2];
const exitCode = runBundleExternalsCheck(
  outDirArg === undefined ? resolveOutDir(scriptsDir) : path.resolve(outDirArg),
);

if (exitCode !== 0) {
  process.exit(exitCode);
}
