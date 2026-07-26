---
name: fixlang-bundle-externals
description: "Use when adding, upgrading, or importing a runtime dependency (dependencies or devDependencies used at runtime), when debugging a packaged app that dies at launch or a window that loses IPC while dev/test/lint were all green, or when touching `build.files`, `electron.vite.config.ts` output format, or `scripts/check-bundle-externals.ts` / `src/shared/bundleExternals.ts`. Examples: \"add a new npm package\", \"packaged app crashes but dev works fine\", \"MODULE_NOT_FOUND in production\", \"why is app.asar so small now\"."
---

# FixLang — Bundle Externals Playbook

## The invariant

`app.asar` ships **no `node_modules`** — `build.files` in `package.json`
excludes it (`"!node_modules/**/*"`), which is most of why the packaged app
shrank (DMG 122.6 → 101.6 MiB, `app.asar` 48.4 → 5.0 MiB). The entire premise
is that electron-vite/Rollup **inlines every runtime dependency** into
`out/main`, `out/preload`, and their chunks.

That premise holds only as long as every `import`/`require` of a third-party
package actually gets bundled instead of left as a bare specifier for Node to
resolve at runtime.

## Why this bites silently

`bun run dev`, `bun run test`, and `bun run lint` all run against
**source** or against `node_modules` still present on disk — none of them
build the packaged bundle and check it. A dependency Vite fails to inline
(dynamic `require`, `createRequire`, a package with a broken `exports` map,
etc.) passes every one of those checks. The **only** thing that catches it is
running the real build and scanning its output:

```bash
bun run build
bun run check:bundle
```

`check:bundle` (`scripts/check-bundle-externals.ts`, logic in
`src/shared/bundleExternals.ts`) AST-scans everything under `out/` for a
`require()`/`import()` call whose argument is a bare specifier that is not a
Node builtin, not an Electron-runtime specifier, and not on the (empty, and it
should stay empty — see the comment on `ALLOWLIST`) allowlist. It exits
non-zero on any hit, on a file it could not scan, and on an empty `out/`.

Exempt without an allowlist entry, because the runtime resolves them itself:
Node builtins (bare names, `node:`-prefixed, and the exact core subpaths in
`BARE_BUILTIN_SUBPATHS` such as `fs/promises`), and the five specifiers in
`ELECTRON_RUNTIME_SPECIFIERS` — `electron`, `electron/main`,
`electron/common`, `electron/renderer`, `electron/utility`. All are matched
**exactly, never by root segment**: `fs/nope`, `electron/nope`,
`electron/main/extra` and `electron-store` are all still violations, because
they really would resolve out of `node_modules`.

## When this actually gets checked

- CI: the `release` job in `.github/workflows/release.yml` runs
  `bun run build` then `bun run check:bundle` before building the DMG.
- Locally: nothing runs it for you. Run it yourself — after `bun run build` —
  whenever you add or upgrade a runtime dependency, and before
  `pack` / `pack:mac` / `pack:install` / `release:mac` if you are producing a
  distributable to hand to someone else.

If you skip the local check, first signal of a real problem is either a CI
failure (recoverable) or a shipped app that throws `MODULE_NOT_FOUND` at
startup (main process) or at window creation (a preload chunk — which takes
the whole `contextBridge` IPC surface down with it, so every affected window
looks silently broken, not just the feature that added the dependency).

## Do not touch

`scripts/check-bundle-externals.ts` and `src/shared/bundleExternals.ts` (and
their tests) are the scanner itself. If the scanner looks wrong or incomplete,
that is a distinct, deliberately-owned piece of work — flag it, don't patch it
inline as part of an unrelated change.

## If you do have to touch the scanner

**Unit tests are not evidence here.** Three separate rounds shipped a change
that passed its own tests and was still dead in the shipped CLI. Prove every
change by executing the real thing:

```bash
cp out/main/index.cjs /tmp/bak
printf '\n%s\n' '<the hostile form>' >> out/main/index.cjs
bun run check:bundle; echo "EXIT=$?"   # must be 1
cp /tmp/bak out/main/index.cjs
```

Traps, all of which have bitten:

- **vitest ≠ bun.** Vitest transpiles with esbuild; the CLI runs under bun's
  own TypeScript parser. Bun erases a statement-position call to a function
  named `declare` as an ambient declaration — that alone disabled alias
  resolution with 47 unit tests green. Never name a scanner helper `declare`,
  and keep the "CLI under bun" describe blocks populated.
- **Nothing exercises a spaced checkout path except one describe block.** The
  original entry guard compared a percent-encoded `import.meta.url` against a
  raw `process.argv[1]`, so a path with a space made the gate exit 0 without
  scanning. There is no entry guard now, and a test stages the CLI under a
  `mkdtemp` "fix lang cli " directory to keep it that way. Do not add one back.
- **`(0, f)(x)` is everywhere** — 925 occurrences in today's `out/main/index.cjs`.
  Any new callee inspection must go through `unwrapExpression`, or it will not
  see the comma-operator form that bundlers actually emit.
- **Bundlers rename both ends** of `createRequire` — the factory *and* its
  result. Both are resolved through order-independent alias graphs; matching
  either by literal identifier text reintroduces the hole.

Knowingly open, absent from today's bundle, deliberately not chased: esbuild's
`__require` interop shim, `exports.req = require`, require passed as a function
argument, `require.bind(null)`, and require stored as an object property.

## Fixing a real hit

Make the bundler inline the dependency (fix the import shape, or the
package's `exports`/`main` fields, so Rollup can statically resolve it).
**Never** "fix" a hit by adding to `ALLOWLIST` — an allowlist entry is an
admission that the module really does load from `node_modules` at runtime,
which no longer exists in the packaged app. That turns the guard green while
the app still throws `MODULE_NOT_FOUND` for users.
