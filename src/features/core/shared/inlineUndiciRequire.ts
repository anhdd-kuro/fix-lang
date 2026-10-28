/**
 * @file inlineUndiciRequire.ts
 * @description Build-time rewrite that lets Vite inline `undici` where a
 * dependency loads it through a runtime `createRequire`.
 *
 * `@ai-sdk/provider-utils` >= 5.0.15 (and the copy `@openrouter/ai-sdk-provider`
 * >= 3.1 inlines) builds its SSRF-safe download fetch with
 * `createRequire(getCurrentModulePath())("undici")`. Rollup cannot follow that,
 * so the bare `undici` survives into `out/main`, `check:bundle` fails, and a
 * packaged app (no `node_modules`) would throw `MODULE_NOT_FOUND` on the first
 * URL download. Swapping the call for a static namespace import makes Rollup
 * bundle the same `undici` package `httpKeepAlive` already ships — `Agent` and
 * `fetch` still come from one package, which is what the dependency needs.
 *
 * Pure and Node-only: imported by `electron.vite.config.ts`, never by app code.
 */
import type { Plugin } from "vite";

/** Local binding the static `undici` namespace import is bound to. */
export const BUNDLED_UNDICI_BINDING = "__fixlangBundledUndici";

/**
 * `createRequire(<fn>())("undici")`, optionally called as `<ns>.createRequire`.
 * Anything else stays untouched, and `check:bundle` remains the backstop for a
 * shape this does not match.
 */
const UNDICI_CREATE_REQUIRE =
  /\b(?:[A-Za-z_$][\w$]*\s*\.\s*)?createRequire\(\s*[A-Za-z_$][\w$]*\(\s*\)\s*\)\(\s*(["'])undici\1\s*\)/g;

/** Returns the rewritten module source, or `null` when nothing matched. */
export function inlineUndiciCreateRequire(code: string): string | null {
  if (!code.includes("createRequire") || !code.includes("undici")) return null;
  const rewritten = code.replace(UNDICI_CREATE_REQUIRE, BUNDLED_UNDICI_BINDING);
  if (rewritten === code) return null;
  return `import * as ${BUNDLED_UNDICI_BINDING} from "undici";\n${rewritten}`;
}

/** Vite plugin applying {@link inlineUndiciCreateRequire} to dependency modules. */
export function inlineUndiciRequirePlugin(): Plugin {
  return {
    name: "fixlang:inline-undici-require",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/node_modules/")) return null;
      const rewritten = inlineUndiciCreateRequire(code);
      return rewritten === null ? null : { code: rewritten, map: null };
    },
  };
}
