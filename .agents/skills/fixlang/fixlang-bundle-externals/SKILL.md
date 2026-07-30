---
name: fixlang-bundle-externals
description: "Use when adding, upgrading, or importing a runtime dependency (dependencies or devDependencies used at runtime), when debugging a packaged app that dies at launch or a window that loses IPC while dev/test/lint were all green, or when touching `build.files`, `electron.vite.config.ts` output format, or `scripts/check-bundle-externals.ts` / `src/features/core/shared/bundleExternals.ts`. Examples: \"add a new npm package\", \"packaged app crashes but dev works fine\", \"MODULE_NOT_FOUND in production\", \"why is app.asar so small now\"."
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
`src/features/core/shared/bundleExternals.ts`) AST-scans everything under `out/` for a
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

`scripts/check-bundle-externals.ts` and `src/features/core/shared/bundleExternals.ts` (and
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

### Two failure axes, not one

Everything below used to be written as if the only way to be wrong was to
**miss** a require (false negative → shipped `MODULE_NOT_FOUND`). There is a
second axis, and it has its own traps:

| axis | symptom | cost |
|---|---|---|
| false negative | scanner exits 0, packaged app throws `MODULE_NOT_FOUND` | ships broken |
| false positive | scanner exits 1 on code that resolves nothing | blocks a legitimate release |

A false positive is loud and attributed (it names file and line), so it is the
cheaper of the two — but it still stops a release, and the temptation when one
fires mid-release is to reach for `ALLOWLIST`, which is the wrong lever and
also would not help (an allowlist entry only silences a *bare specifier*, never
a `non-literal-argument`).

**The false positive that shipped:** every local binding used to be keyed by
bare identifier text, globally, in one pass over the file — no lexical scope.
So one function's genuine `var r = require` promoted **every** `r` in the file,
and worse, it amplified: a real `cr` createRequire alias in one function made
an unrelated function's `var cr = buildHandlerFactory(id)` a factory too, so
`cr(...)`'s result — a name that appears nowhere near a require — became a
require alias and `handler(eventPayload)` got reported. At 2.3 MB with heavy
1–3 character per-scope name reuse this is not exotic; it just had not landed
yet, and none of the fixtures were multi-scope.

**What now prevents it:** bindings are resolved per lexical scope. Rather than
reimplement `var`/function hoisting, `let`/`const`/`class` block scoping,
parameter scopes, catch clauses and function/class expression names,
`createScopeResolver` builds a hermetic single-file `ts.createProgram`
(`noLib`, `noResolve`, in-memory host) and uses
`checker.getSymbolAtLocation` — the compiler's real binder and its real
scope-chain lookup. The alias graphs are keyed by `BindingId` = the `ts.Symbol`
when the name is declared in this file, or `free:<name>` when it is not
(globals, and implicit globals created by an undeclared `r = require`, which
genuinely are one binding per name).

Consequences to keep in mind when editing:

- **Identifiers spelled exactly `require` / `createRequire` are accepted in any
  scope, without consulting the alias sets.** That is deliberate: in bundler
  output `require` is very often the third parameter of a
  `function (module, exports, require)` wrapper, a perfectly ordinary local
  binding, and it really is require. Narrowing this to the free binding alone
  would silently switch the whole CommonJS-wrapper case off.
- **Scope narrowing removes reports, so the risk it carries is false
  negatives.** Every true positive — nested function, arrow, block, hoisted
  `var`, class method, cross-function implicit global — is pinned by both a
  unit fixture and a real-CLI case. Add to both when you add a shape.
- **`with` defeats it, and is handled by refusing to use it.** Inside a `with`
  block the visible names depend on a runtime object, so the binder declines to
  resolve references and `getSymbolAtLocation` returns `undefined` for all of
  them. Reading that as "not declared here" silently dropped
  `var r = require; with (o) { r("left-pad"); }` from the scan entirely. Any
  file containing a `with` statement therefore falls back to `resolveByName` —
  the old scope-unaware, file-wide name keying: noisier, never blind. Detection
  is a real AST check, not a text match, because a property or method named
  `with` (`base.with(patch)`) is ordinary and must not downgrade the file.
  Note the shape of that fallback: **"cannot resolve" must never be spelled the
  same way as "resolves to a global."** Both were `free:<name>`, which is what
  merged them.
- **Cost is a per-file `Program`.** Scanning the real 2.3 MB `out/main/index.cjs`
  went 176 ms → ~340 ms; the 8 000-deep alias chain went 11 ms → ~27 ms against
  a 2 000 ms bound. Resolution is memoised per identifier node because both
  alias passes visit the same nodes. If you make the scanner resolve *every*
  identifier rather than just binding sites and call callees, that is ~800 ms
  per file — a CPU-bound scan hangs CI rather than failing it.
- **`fileLabel` is not the program's file name.** It is a repo-relative path
  and would be normalised against the host's current directory, after which
  `program.getSourceFile(fileLabel)` returns nothing. The program is always
  built around the fixed absolute `SCAN_FILE_NAME`; the label is reporting-only.

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
- **Prove the negatives too.** A matrix that only checks `exit=1` cases cannot
  see a false positive at all — which is why one shipped. Run the
  append-to-a-real-bundle recipe above in both directions: hostile forms that
  must exit 1, *and* innocent forms that must exit 0 (builtin and
  `electron/*` specifiers, `path.resolve`, Rollup's zero-arg shims, and
  same-name-different-scope reuse). The unit suite alone has now missed this
  class twice.

Knowingly open, absent from today's bundle, deliberately not chased: esbuild's
`__require` interop shim, `exports.req = require`, require passed as a function
argument, `require.bind(null)`, and require stored as an object property.

Also open, and all in `forEachBinding` / `destructuredAs` rather than in scope
resolution — verified identical before and after the scope-aware change, so
these are gaps, not regressions:

| shape | why it is missed |
|---|---|
| `function f(g = require)` | a parameter's default value is not a `VariableDeclaration` or a plain assignment |
| `function f({ g = require } = {})` | same, via a binding-pattern default |
| `var [g] = [require]` | `destructuredAs` handles `ObjectBindingPattern` only, not array patterns |
| `var { a: { b: g } } = …` | nested patterns are not walked, only top-level elements |
| `g ||= require` | `plainAssignment` matches `EqualsToken` only, not logical assignment |

Each is a false negative, so each is worth closing if you are already in here.
Note the shared shape: **the binding walk enumerates two syntactic forms, and
anything that binds a name some other way is invisible to it.** Adding a form
to `forEachBinding` is the fix; broadening scope resolution is not.

## Fixing a real hit

Make the bundler inline the dependency (fix the import shape, or the
package's `exports`/`main` fields, so Rollup can statically resolve it).
**Never** "fix" a hit by adding to `ALLOWLIST` — an allowlist entry is an
admission that the module really does load from `node_modules` at runtime,
which no longer exists in the packaged app. That turns the guard green while
the app still throws `MODULE_NOT_FOUND` for users.
