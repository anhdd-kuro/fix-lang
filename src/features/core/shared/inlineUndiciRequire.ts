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
 * bundle the `undici` that module resolves to — for provider-utils that is its
 * own nested `undici` 7.x, not the app's 8.x, so `out/main` carries two copies
 * (~0.9 MB). `Agent` and `fetch` still come from one package, which is what the
 * dependency needs. FixLang sends text-only prompts, so today no request
 * reaches this download path; the rewrite keeps it working if one ever does.
 *
 * Pure and Node-only: imported by `electron.vite.config.ts`, never by app code.
 */
import type { Plugin } from "vite";

/** Local binding the static `undici` namespace import is bound to. */
export const BUNDLED_UNDICI_BINDING = "__fixlangBundledUndici";

/**
 * `createRequire(<fn>())("undici")`, optionally called as `<ns>.createRequire`.
 * The lookbehind refuses a match that starts mid member chain
 * (`f().createRequire`, `m?.createRequire`, `a.b.createRequire`): replacing
 * only its tail would leave `f().__fixlangBundledUndici`, which is `undefined`
 * at runtime yet passes `check:bundle` because the static import still lands.
 */
const UNDICI_CREATE_REQUIRE =
  /(?<![\w$)\].?])(?:[A-Za-z_$][\w$]*\s*\.\s*)?createRequire\(\s*[A-Za-z_$][\w$]*\(\s*\)\s*\)\(\s*(["'])undici\1\s*\)/g;

/** Any `createRequire(...)("undici")` left over after the rewrite. */
const LEFTOVER_UNDICI_CREATE_REQUIRE =
  /createRequire\([\s\S]{0,120}?\)\(\s*["']undici["']\s*\)/;

/**
 * Returns the rewritten module source, or `null` when nothing matched.
 * Throws when an undici `createRequire` survives, so a dependency bump that
 * changes the call shape fails the build here instead of shipping a bare
 * require (or a half-rewritten expression).
 */
export function inlineUndiciCreateRequire(code: string): string | null {
  if (!code.includes("createRequire") || !code.includes("undici")) return null;
  const rewritten = code.replace(UNDICI_CREATE_REQUIRE, BUNDLED_UNDICI_BINDING);
  if (LEFTOVER_UNDICI_CREATE_REQUIRE.test(rewritten)) {
    throw new Error(
      'inlineUndiciRequire: unsupported createRequire("undici") shape; extend UNDICI_CREATE_REQUIRE',
    );
  }
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
