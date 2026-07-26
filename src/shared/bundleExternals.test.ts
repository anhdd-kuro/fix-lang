/**
 * @file bundleExternals.test.ts
 * @description Proof that the bundle-externals guard actually guards.
 *
 * `scanBundleSource` is exercised against synthetic fixture strings, never
 * against the real `out/` build output — a missing or stale `out/` must not
 * make this suite flaky or force `bun run build` before `bun run test`.
 * `collectBundleFiles` and `runBundleExternalsCheck` are exercised against
 * throwaway temp directories shaped like `out/`.
 *
 * Three things are pinned here:
 *   (a) every shape that resolves a module at runtime is flagged — bare and
 *       aliased `require`, `createRequire`-derived requires, `module.require`,
 *       `require.resolve`, dynamic `import()`, and static `import`/re-export;
 *   (b) legal, `node_modules`-free code is NOT flagged — builtins, builtin
 *       subpaths, `node:*`, `electron`, relative/absolute paths, Rollup's
 *       zero-argument commonjs shims, and bare specifiers that exist only as
 *       inert template-literal text;
 *   (c) the CLI's contract — which files get scanned, and the exit code.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWLIST,
  collectBundleFiles,
  resolveOutDir,
  runBundleExternalsCheck,
  scanBundleSource,
} from "./bundleExternals";

const kinds = (source: string): string[] =>
  scanBundleSource(source, "fixture.cjs").map((v) => v.kind);

const details = (source: string): string[] =>
  scanBundleSource(source, "fixture.cjs").map((v) => v.detail);

describe("scanBundleSource", () => {
  it("flags a non-allowlisted bare require() specifier", () => {
    expect(scanBundleSource('require("left-pad");', "fixture.cjs")).toEqual([
      expect.objectContaining({ kind: "bare-specifier", detail: "left-pad" }),
    ]);
  });

  it("flags require() called with a non-literal argument", () => {
    expect(kinds("const name = computeName(); require(name);")).toEqual([
      "non-literal-argument",
    ]);
  });

  it("flags a dynamic import() with a non-literal argument", () => {
    expect(kinds("const spec = pick(); import(spec);")).toEqual([
      "non-literal-argument",
    ]);
  });

  it("flags a dynamic import() of a bare specifier", () => {
    expect(details('import("left-pad");')).toEqual(["left-pad"]);
  });

  // ---- M2: require-like call shapes beyond a literal `require` identifier ----

  it("flags an immediately-invoked createRequire() result", () => {
    expect(details('createRequire(import.meta.url)("left-pad");')).toEqual([
      "left-pad",
    ]);
  });

  it("flags a require function bound from createRequire()", () => {
    expect(
      details(
        'const req = createRequire(import.meta.url);\nreq("left-pad");',
      ),
    ).toEqual(["left-pad"]);
  });

  it("flags a require function bound from module.createRequire()", () => {
    expect(
      details('var require$1 = module.createRequire(__filename);\nrequire$1("left-pad");'),
    ).toEqual(["left-pad"]);
  });

  // ---- F2: the createRequire *factory* itself can be renamed ----
  //
  // The scanner already expects a bundler to rename the factory's *result*
  // (`require$1`). Renaming the factory binding is just as routine, and it
  // used to switch the entire alias chain off: the factory was matched by the
  // exact identifier text "createRequire".

  it("flags a require bound via a renamed createRequire factory", () => {
    expect(
      details(
        [
          'const createRequire$1 = require("node:module").createRequire;',
          "const r = createRequire$1(import.meta.url);",
          'r("left-pad");',
        ].join("\n"),
      ),
    ).toEqual(["left-pad"]);
  });

  it("flags a require bound via an arbitrarily named createRequire factory", () => {
    expect(
      details(
        [
          'const cr = require("node:module").createRequire;',
          "const r = cr(__filename);",
          'r("left-pad");',
        ].join("\n"),
      ),
    ).toEqual(["left-pad"]);
  });

  it("flags a require bound via a destructured createRequire factory", () => {
    expect(
      details(
        [
          'const { createRequire: mk } = require("node:module");',
          "const r = mk(__filename);",
          'r("left-pad");',
        ].join("\n"),
      ),
    ).toEqual(["left-pad"]);
  });

  it("flags a require bound via a chained factory rename", () => {
    expect(
      details(
        [
          "const cr2 = cr;",
          'const cr = require("node:module").createRequire;',
          "const r = cr2(__filename);",
          'r("left-pad");',
        ].join("\n"),
      ),
    ).toEqual(["left-pad"]);
  });

  it("flags an immediately-invoked renamed factory", () => {
    expect(
      details(
        [
          'const cr = require("node:module").createRequire;',
          'cr(import.meta.url)("left-pad");',
        ].join("\n"),
      ),
    ).toEqual(["left-pad"]);
  });

  it("does not treat an unrelated factory-shaped binding as a require source", () => {
    // Only a binding whose initializer actually names `createRequire` counts.
    expect(kinds('const mk = require("node:module").createHash;\nmk("left-pad");')).toEqual([]);
  });

  it("flags an aliased require identifier", () => {
    expect(details('var r = require;\nr("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags a transitively aliased require identifier", () => {
    expect(details('var r = require;\nvar q = r;\nq("left-pad");')).toEqual([
      "left-pad",
    ]);
  });

  it("flags a require destructured out of an object", () => {
    expect(details('const { require: r } = module;\nr("left-pad");')).toEqual([
      "left-pad",
    ]);
  });

  it("flags aliases declared before the binding they derive from", () => {
    // Alias resolution must not depend on declaration order: hoisting and
    // bundler output both reorder freely.
    expect(details('var q = r;\nvar r = require;\nq("left-pad");')).toEqual([
      "left-pad",
    ]);
  });

  it("resolves a long alias chain without quadratic blowup", () => {
    // Each alias is declared *before* the one it derives from, so a
    // re-walk-until-stable fixpoint resolves exactly one binding per full AST
    // pass — O(passes x nodes). Alias edges are propagated with a worklist
    // instead, so this stays linear. Contrived, but this guard's whole job is
    // to hold up against bundle content nobody hand-reviewed, and a
    // CPU-bound scan cannot be interrupted by a test/CI timeout — it just
    // hangs. Measured at this depth: ~3.7s quadratic, ~30ms with the
    // worklist, so the bound below has room for a slow machine either way.
    const depth = 8_000;
    const lines = [`a0("left-pad");`];
    for (let i = 0; i < depth; i += 1) lines.push(`var a${String(i)} = a${String(i + 1)};`);
    lines.push(`var a${String(depth)} = require;`);
    const source = lines.join("\n");

    const startedAt = Date.now();
    const found = details(source);
    const elapsed = Date.now() - startedAt;

    expect(found).toEqual(["left-pad"]);
    expect(elapsed).toBeLessThan(2_000);
  });

  // ---- F1: comma-operator callees ----
  //
  // `(0, f)(x)` is the standard esbuild/Rollup/tsc idiom for calling `f`
  // with `this` stripped, and it is everywhere in real output (`grep -c '(0, '`
  // over out/main/index.cjs: 925). A callee walk that only strips parentheses
  // sees a BinaryExpression and gives up, so every require shape below
  // disappears from the scan the moment a bundler emits it this way.

  it("flags a comma-operator-wrapped require callee", () => {
    expect(details('(0, require)("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags a comma-operator-wrapped module.require callee", () => {
    expect(details('(0, module.require)("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags a comma-operator-wrapped require.resolve callee", () => {
    expect(details('(0, require.resolve)("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags a comma-operator-wrapped require alias", () => {
    expect(details('var r = require;\n(0, r)("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags a require alias bound through a comma operator", () => {
    expect(details('var r = (0, require);\nr("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags a non-literal argument through a comma-operator callee", () => {
    expect(kinds("(0, require)(computeName());")).toEqual(["non-literal-argument"]);
  });

  it("does not flag an unrelated comma-operator callee", () => {
    expect(kinds('(0, path.resolve)(dir, "left-pad");')).toEqual([]);
  });

  it("flags module.require()", () => {
    expect(details('module.require("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags process.mainModule.require()", () => {
    expect(details('process.mainModule.require("left-pad");')).toEqual([
      "left-pad",
    ]);
  });

  it("flags require.main.require()", () => {
    expect(details('require.main.require("left-pad");')).toEqual(["left-pad"]);
  });

  it("flags require.resolve() and an aliased .resolve()", () => {
    expect(details('require.resolve("left-pad");')).toEqual(["left-pad"]);
    expect(details('var r = require;\nr.resolve("left-pad");')).toEqual([
      "left-pad",
    ]);
  });

  it("flags bracket-form require.resolve()", () => {
    // Minifiers and property-mangler configs emit `require["resolve"]` for the
    // same call `require.resolve` expresses; `["require"]` was already handled,
    // so handling only the dotted `.resolve` was an inconsistency, not a
    // decision.
    expect(details('require["resolve"]("left-pad");')).toEqual(["left-pad"]);
    expect(details('var r = require;\nr["resolve"]("left-pad");')).toEqual(["left-pad"]);
    expect(details('(0, require["resolve"])("left-pad");')).toEqual(["left-pad"]);
  });

  it("does not flag an unrelated bracket-form .resolve()", () => {
    expect(kinds('path["resolve"](dir, "left-pad");')).toEqual([]);
  });

  it("does not flag a computed .resolve() on a require alias", () => {
    // A non-literal key could be anything; there is no specifier to read, and
    // `require[k]("x")` would be reported by the non-literal path only if it
    // were a require call, which cannot be decided here. Stay quiet rather
    // than fail a release on an unknowable.
    expect(kinds('var r = require;\nr[key]("left-pad");')).toEqual([]);
  });

  it("flags a non-literal argument through an aliased require", () => {
    expect(kinds('var r = require;\nr(computeName());')).toEqual([
      "non-literal-argument",
    ]);
  });

  // ---- M3: static import / re-export specifiers ----

  it("flags a bare static import declaration", () => {
    expect(details('import leftPad from "left-pad";')).toEqual(["left-pad"]);
  });

  it("flags a bare side-effect import declaration", () => {
    expect(details('import "left-pad";')).toEqual(["left-pad"]);
  });

  it("flags a bare `export * from` re-export", () => {
    expect(details('export * from "left-pad";')).toEqual(["left-pad"]);
  });

  it("flags a bare named re-export", () => {
    expect(details('export { pad } from "left-pad";')).toEqual(["left-pad"]);
  });

  it("does not flag relative or builtin static imports, or local exports", () => {
    expect(
      kinds(
        [
          'import fs from "node:fs";',
          'import { x } from "./chunks/token.cjs";',
          'import { app } from "electron";',
          'export * from "./local.cjs";',
          "export const y = 1;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  // ---- m1: builtin subpaths are legal Node, not violations ----

  it("does not flag un-prefixed Node builtin subpaths", () => {
    expect(
      kinds(
        [
          'require("fs/promises");',
          'require("assert/strict");',
          'require("dns/promises");',
          'require("path/posix");',
          'require("path/win32");',
          'require("stream/promises");',
          'require("stream/web");',
          'require("stream/consumers");',
          'require("timers/promises");',
          'require("util/types");',
          'require("readline/promises");',
          'require("inspector/promises");',
          'require("node:fs/promises");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("still flags a non-builtin package subpath", () => {
    expect(details('require("left-pad/dist/index.js");')).toEqual([
      "left-pad/dist/index.js",
    ]);
  });

  it("still flags a subpath whose root only looks like a builtin", () => {
    // `fs` is a builtin but `fs/nope` is not a real builtin subpath, so this
    // would node_modules-resolve at runtime and must not be waved through.
    expect(details('require("fs/nope");')).toEqual(["fs/nope"]);
  });

  // ---- false-negative guards that must keep passing ----

  it("does not flag Node builtins, node:-prefixed builtins, or electron", () => {
    expect(
      kinds(
        [
          'require("fs");',
          'require("node:path");',
          'require("electron");',
          // node:sqlite has no bare form and is absent from Bun's own
          // builtinModules/isBuiltin() introspection (it reports bun:sqlite
          // instead) even though it is a real Node builtin the main bundle
          // requires. The scanner must trust the node: prefix itself rather
          // than delegating to the runtime it happens to execute under.
          'require("node:sqlite");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not flag the electron/* runtime entry points", () => {
    // Verified in a real Electron 43 main process launched from a directory
    // with no node_modules anywhere on its resolution path: `electron`,
    // `electron/main`, `electron/common`, `electron/renderer` and
    // `electron/utility` all resolve, because the Electron runtime provides
    // them itself. Flagging them blocked a release for working code.
    expect(
      kinds(
        [
          'require("electron/main");',
          'require("electron/common");',
          'require("electron/renderer");',
          'require("electron/utility");',
          'import { app } from "electron/main";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("still flags an electron subpath the runtime does not provide", () => {
    // Matched exactly, never by root segment: `electron/nope` throws
    // MODULE_NOT_FOUND in the same runtime, and `electron-store` is an
    // ordinary npm package that merely starts with the same letters.
    expect(details('require("electron/nope");')).toEqual(["electron/nope"]);
    expect(details('require("electron-store");')).toEqual(["electron-store"]);
    expect(details('require("electron/main/extra");')).toEqual(["electron/main/extra"]);
  });

  it("does not flag relative or absolute specifiers", () => {
    expect(
      kinds(
        [
          'require("./chunks/token.cjs");',
          'require("../index.cjs");',
          'require("/opt/homebrew/bin/brew");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not flag a bare specifier that only appears as template-literal text", () => {
    // Ajv's standalone codegen embeds `require("ajv/...")` as source *text*
    // inside a tagged template; it is data, never an executed call. A regex
    // over raw text would match it forever. The AST walk must not, because
    // there is no CallExpression here at all.
    expect(
      kinds(
        'const code = tag`require("ajv/dist/runtime/validation_error").default`;',
      ),
    ).toEqual([]);
  });

  it("does not flag Rollup's zero-argument commonjs shim calls", () => {
    // Rollup emits `var require_code$3 = __commonJSMin(...)` wrappers and calls
    // them as `require_code$3()`. They take no specifier and resolve nothing.
    expect(
      kinds(
        [
          "var require_code$3 = __commonJSMin((exports) => {});",
          "var code_1 = require_code$3();",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not flag an unrelated .resolve() such as path.resolve()", () => {
    expect(kinds('path.resolve(dir, "left-pad");')).toEqual([]);
  });

  it("does not flag a bare specifier explicitly passed in the allowlist", () => {
    expect(
      scanBundleSource('require("some-allowlisted-pkg");', "fixture.cjs", [
        "some-allowlisted-pkg",
      ]),
    ).toEqual([]);
  });

  it("ships with an empty default allowlist", () => {
    // The guard's premise is that electron-vite inlines every runtime
    // dependency into out/, so no bare specifier should survive into a built
    // bundle. An entry here is an admission that something is loaded from
    // node_modules at runtime — which app.asar no longer ships. Keep it empty
    // unless a scan of a fresh `bun run build` proves otherwise.
    expect(ALLOWLIST).toEqual([]);
  });

  it("reports the 1-based line of each violation", () => {
    const violations = scanBundleSource(
      ['const a = 1;', 'require("left-pad");'].join("\n"),
      "fixture.cjs",
    );
    expect(violations).toEqual([
      expect.objectContaining({ file: "fixture.cjs", line: 2 }),
    ]);
  });
});

describe("resolveOutDir", () => {
  it("resolves out/ as a sibling of the scripts directory", () => {
    expect(resolveOutDir("/repo/scripts")).toBe(path.join("/repo", "out"));
  });
});

describe("collectBundleFiles", () => {
  let outDir = "";

  const write = (relPath: string, contents = ""): void => {
    const target = path.join(outDir, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  };

  const rel = (): string[] =>
    collectBundleFiles(outDir).map((f) => path.relative(outDir, f));

  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), "fixlang-bundle-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("collects the main and preload entry bundles", () => {
    write("main/index.cjs");
    write("preload/index.cjs");
    expect(rel()).toEqual(["main/index.cjs", "preload/index.cjs"]);
  });

  it("collects preload chunks, not just main chunks", () => {
    // electron.vite.config.ts configures `chunkFileNames: "chunks/[name].cjs"`
    // for preload exactly as it does for main. A bare require in a preload
    // chunk throws MODULE_NOT_FOUND at window creation and takes the whole
    // contextBridge IPC surface down.
    write("main/index.cjs");
    write("main/chunks/token.cjs");
    write("preload/index.cjs");
    write("preload/chunks/testChunk.cjs");
    expect(rel()).toContain("preload/chunks/testChunk.cjs");
  });

  it("recurses into nested chunk directories", () => {
    write("main/chunks/nested/deep/leaf.cjs");
    expect(rel()).toEqual(["main/chunks/nested/deep/leaf.cjs"]);
  });

  it("collects non-.cjs script output too", () => {
    // Guards against silently scanning nothing if the build ever switches
    // main/preload away from `format: "cjs"` / `.cjs` file names.
    write("main/index.js");
    write("main/worker.mjs");
    expect(rel().sort()).toEqual(["main/index.js", "main/worker.mjs"]);
  });

  it("ignores non-script emissions such as html and sourcemaps", () => {
    write("main/index.cjs");
    write("main/chunks/overlay-BUynvbef.html");
    write("main/index.cjs.map");
    expect(rel()).toEqual(["main/index.cjs"]);
  });

  it("ignores the renderer output", () => {
    // out/renderer is Chromium-loaded browser ESM with no Node resolver; its
    // hashed chunk graph would only produce noise here.
    write("main/index.cjs");
    write("renderer/main-DStUlvDH.js");
    expect(rel()).toEqual(["main/index.cjs"]);
  });

  it("returns an empty list when out/ does not exist", () => {
    expect(collectBundleFiles(path.join(outDir, "missing"))).toEqual([]);
  });

  it("returns a deterministic, sorted list", () => {
    write("main/chunks/b.cjs");
    write("main/chunks/a.cjs");
    write("main/index.cjs");
    expect(rel()).toEqual([
      "main/chunks/a.cjs",
      "main/chunks/b.cjs",
      "main/index.cjs",
    ]);
  });
});

describe("runBundleExternalsCheck", () => {
  let outDir = "";
  let out: string[] = [];
  let err: string[] = [];

  const write = (relPath: string, contents: string): void => {
    const target = path.join(outDir, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  };

  const run = (): number =>
    runBundleExternalsCheck(outDir, {
      log: (m) => out.push(m),
      error: (m) => err.push(m),
    });

  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), "fixlang-check-"));
    out = [];
    err = [];
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("exits 0 on a clean tree", () => {
    write("main/index.cjs", 'require("node:fs");\nrequire("./chunks/token.cjs");');
    write("preload/index.cjs", 'require("electron");');
    expect(run()).toBe(0);
    expect(out.join("\n")).toContain("main/index.cjs");
  });

  it("exits 1 on exactly one violation", () => {
    // Pins the `total > 0` threshold: a `total > 1` mutant would return 0 here.
    write("main/index.cjs", 'require("left-pad");');
    expect(run()).toBe(1);
    expect(out.join("\n")).toContain("1 total violation(s) found.");
  });

  it("exits 1 on a violation that lives only in a preload chunk", () => {
    write("main/index.cjs", 'require("node:fs");');
    write("preload/index.cjs", 'require("electron");');
    write("preload/chunks/testChunk.cjs", 'require("left-pad");');
    expect(run()).toBe(1);
    expect(out.join("\n")).toContain("left-pad");
  });

  it("exits 1 and explains itself when out/ holds no bundle files", () => {
    expect(run()).toBe(1);
    expect(err.join("\n")).toContain("no bundle files found");
  });

  it("prints each violation's kind, line and detail", () => {
    write("main/index.cjs", 'require("left-pad");');
    run();
    expect(out.join("\n")).toContain("[bare-specifier] line 1: left-pad");
  });
});

/**
 * Drives `scripts/check-bundle-externals.ts` as a real subprocess under `bun`,
 * the runtime CI actually uses.
 *
 * This is not a redundant copy of the unit tests. Vitest transpiles TypeScript
 * with esbuild; `bun run` uses Bun's own TypeScript parser, and they disagree
 * on at least one construct that silently changed this scanner's behaviour —
 * Bun erases a statement-position call to a function named `declare`, reading
 * it as an ambient declaration. The unit suite was fully green while the
 * shipped CLI failed to resolve require aliases at all. Only executing the
 * real entry point under the real runtime catches that class of bug.
 */
describe("check-bundle-externals CLI under bun", () => {
  const cliPath = path.join(__dirname, "..", "..", "scripts", "check-bundle-externals.ts");
  let outDir = "";

  const write = (relPath: string, contents: string): void => {
    const target = path.join(outDir, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  };

  const runCli = (): { status: number | null; stdout: string } => {
    const result = spawnSync("bun", ["run", cliPath, outDir], { encoding: "utf8" });
    return { status: result.status, stdout: `${result.stdout}${result.stderr}` };
  };

  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), "fixlang-cli-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("exits 0 on a clean tree", () => {
    write("main/index.cjs", 'require("node:fs");\nrequire("fs/promises");');
    expect(runCli().status).toBe(0);
  });

  it("exits 1 on every require-like shape, including aliased and derived ones", () => {
    // One shape per file so a single miss cannot hide behind another's hit.
    const shapes: Record<string, string> = {
      "main/bare.cjs": 'require("left-pad");',
      "main/aliased.cjs": 'var r = require;\nr("left-pad");',
      "main/createRequireIife.cjs": 'createRequire(import.meta.url)("left-pad");',
      "main/createRequireBound.cjs":
        'const req = createRequire(import.meta.url);\nreq("left-pad");',
      "main/moduleRequire.cjs": 'module.require("left-pad");',
      "main/staticImport.cjs": 'import lp from "left-pad";',
      "main/commaRequire.cjs": '(0, require)("left-pad");',
      "main/commaModuleRequire.cjs": '(0, module.require)("left-pad");',
      "main/commaRequireResolve.cjs": '(0, require.resolve)("left-pad");',
      "main/commaAlias.cjs": 'var r = require;\n(0, r)("left-pad");',
      "main/renamedFactory.cjs":
        'const createRequire$1 = require("node:module").createRequire;\n' +
        "const r = createRequire$1(import.meta.url);\n" +
        'r("left-pad");',
      "main/destructuredFactory.cjs":
        'const { createRequire: mk } = require("node:module");\n' +
        "const r = mk(__filename);\n" +
        'r("left-pad");',
      "main/bracketResolve.cjs": 'require["resolve"]("left-pad");',
      "preload/chunks/testChunk.cjs": 'require("left-pad");',
    };

    for (const [file, source] of Object.entries(shapes)) {
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      write(file, source);
      const { status, stdout } = runCli();
      expect({ file, status }).toEqual({ file, status: 1 });
      expect(stdout).toContain("left-pad");
    }
  });

  it("exits 1 when out/ holds no bundles at all", () => {
    expect(runCli().status).toBe(1);
  });
});
