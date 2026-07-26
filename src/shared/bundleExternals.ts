/**
 * @file bundleExternals.ts
 * @description Core of the bundle-externals guardrail. AST-scans the built
 * Node-side bundles under `out/` for anything that would resolve a module from
 * `node_modules` at runtime: a bare specifier (not a Node builtin, not
 * `electron`, not a relative/absolute path) that isn't allowlisted, or a
 * `require()`/`import()` whose argument isn't a string literal at all.
 *
 * Why this exists: `build.files` no longer ships `node_modules` inside
 * `app.asar`, on the premise that electron-vite inlines every runtime
 * dependency into `out/`. This guard is what enforces that premise. Anything
 * it lets through becomes a `MODULE_NOT_FOUND` in a shipped app — at startup
 * for the main process, or at window creation for a preload chunk, which takes
 * the whole contextBridge IPC surface down with it.
 *
 * Uses the TypeScript compiler API (already a devDependency — no new package
 * needed) to parse the built files and walk real AST nodes, not a regex. A
 * regex would also match strings like
 * `require("ajv/dist/runtime/validation_error")` that live only inside Ajv's
 * standalone-codegen template-literal *text* and are never executed, so it
 * would "fail" forever on inert data. Walking the AST ignores that text
 * automatically, no special-casing needed.
 *
 * The CLI wrapper is `scripts/check-bundle-externals.ts` (`bun run
 * check:bundle`); the logic lives here so it is unit-testable and covered.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type BundleViolationKind = "bare-specifier" | "non-literal-argument";

export type BundleViolation = {
  readonly file: string;
  readonly line: number;
  readonly kind: BundleViolationKind;
  readonly detail: string;
};

/**
 * Empty on purpose, and it should stay that way.
 *
 * The invariant this guard protects is "every runtime dependency is inlined
 * into `out/` by electron-vite, because `app.asar` ships no `node_modules`".
 * An entry here is an admission that some module really is loaded from
 * `node_modules` at runtime — which is exactly the thing that no longer
 * exists in the packaged app. Adding one therefore does not fix a failure, it
 * hides it: the guard goes green and the app throws MODULE_NOT_FOUND for
 * users instead.
 *
 * The only legitimate use is a specifier that is resolvable *outside* the asar
 * (an unpacked resource, or a module provided by the Electron runtime itself).
 * Anything else should be fixed by making the bundler inline it.
 */
export const ALLOWLIST: readonly string[] = [];

/**
 * Deliberately NOT derived from `node:module`'s `builtinModules` / `isBuiltin`.
 * This script runs under `bun run`, and Bun's own implementation of that list
 * is Bun-flavored, not Node's: it is missing real Node-only-prefixed builtins
 * the bundle actually requires (notably `node:sqlite`), and it adds Bun-only
 * entries (`bun:sqlite`, `bun:test`, `ws`, `undici`) that are not Node core
 * modules at all. Trusting it would either miss a real violation or flag a
 * legitimate builtin. This is the stable, documented set of Node core modules
 * loadable via their bare (unprefixed) name; anything requiring the mandatory
 * `node:` prefix (e.g. `node:sqlite`, `node:test`, `node:sea`) is handled
 * separately below by trusting the prefix itself, since `node:` is a reserved
 * URL scheme no npm package can occupy.
 */
const BARE_BUILTIN_NAMES = new Set<string>([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/**
 * Node core modules exposed at a subpath of a bare builtin name. These are
 * legal, `node_modules`-free requires — `require("fs/promises")` resolves to
 * core, never to a package — so treating the specifier set as exact-match over
 * {@link BARE_BUILTIN_NAMES} alone would fail a release for working code.
 *
 * Matched exactly rather than by root segment on purpose: `require("fs/nope")`
 * is NOT a builtin (Node falls back to resolving a package called `fs`), so a
 * root-segment rule would wave a genuine `node_modules` load through. When a
 * future Node release adds a core subpath, add it here — the failure mode is a
 * loud, one-line fix rather than a silent hole.
 */
const BARE_BUILTIN_SUBPATHS = new Set<string>([
  "assert/strict",
  "dns/promises",
  "fs/promises",
  "inspector/promises",
  "path/posix",
  "path/win32",
  "readline/promises",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "timers/promises",
  "util/types",
]);

/** File extensions Node will actually load from `out/`. */
export const BUNDLE_SCRIPT_EXTENSIONS: readonly string[] = [".cjs", ".js", ".mjs"];

/**
 * Top-level `out/` subdirectories excluded from the scan. `out/renderer` is
 * Chromium-loaded browser ESM behind `contextIsolation` — it has no Node
 * resolver, its chunk graph is entirely hashed relative paths, and Vite's own
 * lazy-chunk loader uses non-literal `import()` by design.
 */
export const UNSCANNED_OUT_SUBDIRS: readonly string[] = ["renderer"];

const isRelativeOrAbsolute = (specifier: string): boolean =>
  specifier.startsWith(".") || specifier.startsWith("/");

const isBuiltinOrElectron = (specifier: string): boolean =>
  specifier === "electron" ||
  specifier.startsWith("node:") ||
  BARE_BUILTIN_NAMES.has(specifier) ||
  BARE_BUILTIN_SUBPATHS.has(specifier);

const isBareSpecifier = (specifier: string): boolean =>
  !isRelativeOrAbsolute(specifier) && !isBuiltinOrElectron(specifier);

/** Factory that hands back a CommonJS `require` function. */
const CREATE_REQUIRE = "createRequire";

/** `createRequire` / `module.createRequire` / `Module.createRequire`. */
const isCreateRequireReference = (node: ts.Expression): boolean =>
  (ts.isIdentifier(node) && node.text === CREATE_REQUIRE) ||
  (ts.isPropertyAccessExpression(node) && node.name.text === CREATE_REQUIRE);

/** Strips parentheses and returns the identifier name, if that is all there is. */
const identifierName = (node: ts.Expression): string | undefined => {
  if (ts.isParenthesizedExpression(node)) return identifierName(node.expression);
  return ts.isIdentifier(node) ? node.text : undefined;
};

/**
 * True for an expression that is a `require` function on its own terms, with
 * no knowledge of local bindings: member access ending in `.require`
 * (`module.require`, `process.mainModule.require`, `require.main.require`) or
 * an immediately-invoked `createRequire(import.meta.url)`.
 */
const isIntrinsicRequireExpression = (node: ts.Expression): boolean => {
  if (ts.isParenthesizedExpression(node)) return isIntrinsicRequireExpression(node.expression);
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "require";
  if (ts.isElementAccessExpression(node)) {
    return (
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "require"
    );
  }
  if (ts.isCallExpression(node)) return isCreateRequireReference(node.expression);
  return false;
};

/**
 * True when `node` evaluates to a `require` function rather than merely being
 * spelled `require` — an intrinsic form, or any locally-bound alias discovered
 * by {@link collectRequireBindings}.
 */
const isRequireExpression = (node: ts.Expression, bindings: ReadonlySet<string>): boolean => {
  const name = identifierName(node);
  return name === undefined ? isIntrinsicRequireExpression(node) : bindings.has(name);
};

/**
 * Names bound to a require function in this file. Seeded with `require`, since
 * bundlers rename the `createRequire` result (`require$1`, `req`, …) and code
 * aliases it (`var r = require`, `const { require: r } = module`).
 *
 * Done in one AST pass that records plain `name = otherName` edges, followed by
 * a worklist walk of those edges — deliberately not a re-walk-the-tree-until-
 * stable fixpoint, which degrades to O(passes x nodes) when aliases appear
 * before the binding they derive from and would let a pathological bundle hang
 * the release job (a CPU-bound scan cannot be interrupted by a CI timeout).
 */
const collectRequireBindings = (sourceFile: ts.SourceFile): ReadonlySet<string> => {
  const bindings = new Set<string>(["require"]);
  /** alias source name -> names that copy it. */
  const dependents = new Map<string, string[]>();
  const pending: string[] = ["require"];

  const seed = (name: string): void => {
    if (bindings.has(name)) return;
    bindings.add(name);
    pending.push(name);
  };

  // NOT named `declare`: `bun run` (which is how this ships) parses a
  // statement-position `declare(...)` call as an ambient TypeScript
  // declaration and erases it outright, while vitest's esbuild transform keeps
  // it. That divergence silently disabled alias resolution here with the whole
  // unit suite green — see the CLI-under-bun test.
  const recordAlias = (name: string, initializer: ts.Expression): void => {
    if (isIntrinsicRequireExpression(initializer)) {
      seed(name);
      return;
    }
    const source = identifierName(initializer);
    if (source === undefined) return;
    const edges = dependents.get(source);
    if (edges === undefined) {
      dependents.set(source, [name]);
    } else {
      edges.push(name);
    }
  };

  /** `const { require: r } = module` / `const { require } = process.mainModule`. */
  const recordDestructuredAlias = (pattern: ts.ObjectBindingPattern): void => {
    for (const element of pattern.elements) {
      const property = element.propertyName ?? element.name;
      if (
        ts.isIdentifier(property) &&
        property.text === "require" &&
        ts.isIdentifier(element.name)
      ) {
        seed(element.name.text);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      if (ts.isObjectBindingPattern(node.name)) {
        recordDestructuredAlias(node.name);
      } else if (ts.isIdentifier(node.name) && node.initializer !== undefined) {
        recordAlias(node.name.text, node.initializer);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      recordAlias(node.left.text, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Each name enters `pending` at most once, so this visits every edge once.
  while (pending.length > 0) {
    const source = pending.pop();
    if (source === undefined) break;
    for (const dependent of dependents.get(source) ?? []) {
      seed(dependent);
    }
  }

  return bindings;
};

/**
 * True for a call that resolves a module specifier: `require(…)`,
 * `require.resolve(…)`, any aliased/derived form of either, or a dynamic
 * `import(…)`.
 */
const isModuleResolvingCall = (
  node: ts.CallExpression,
  bindings: ReadonlySet<string>,
): boolean => {
  const callee = node.expression;
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (isRequireExpression(callee, bindings)) return true;
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "resolve" &&
    isRequireExpression(callee.expression, bindings)
  );
};

const lineOf = (sourceFile: ts.SourceFile, pos: number): number =>
  sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

/**
 * Scans one bundle's source text and returns every violation: a
 * module-resolving call whose argument is not a string literal, or a literal
 * bare specifier — from a call, a static `import`, or a re-export — that is
 * not a builtin, `electron`, a relative/absolute path, or allowlisted.
 */
export function scanBundleSource(
  source: string,
  fileLabel: string,
  allowlist: readonly string[] = ALLOWLIST,
): BundleViolation[] {
  const sourceFile = ts.createSourceFile(
    fileLabel,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const bindings = collectRequireBindings(sourceFile);
  const violations: BundleViolation[] = [];

  const report = (node: ts.Node, kind: BundleViolationKind, detail: string): void => {
    violations.push({
      file: fileLabel,
      line: lineOf(sourceFile, node.getStart(sourceFile)),
      kind,
      detail,
    });
  };

  const checkSpecifier = (node: ts.Node, specifier: string): void => {
    if (isBareSpecifier(specifier) && !allowlist.includes(specifier)) {
      report(node, "bare-specifier", specifier);
    }
  };

  const visit = (node: ts.Node): void => {
    // Static `import … from "x"` / `export … from "x"`. Invisible to a
    // call-expression-only walk, and only absent from today's output because
    // electron.vite.config.ts pins `format: "cjs"` — nothing ties the two
    // together, so scan for them regardless.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
        checkSpecifier(node, specifier.text);
      }
    } else if (ts.isCallExpression(node) && isModuleResolvingCall(node, bindings)) {
      const [arg] = node.arguments;
      if (arg !== undefined) {
        if (ts.isStringLiteralLike(arg)) {
          checkSpecifier(node, arg.text);
        } else {
          report(node, "non-literal-argument", node.getText(sourceFile).slice(0, 120));
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/** `out/` as a sibling of the given `scripts/` directory. */
export const resolveOutDir = (scriptsDir: string): string =>
  path.join(scriptsDir, "..", "out");

/**
 * Every Node-loaded script emitted under `outDir`, discovered by recursive
 * walk rather than by naming known entry points. Hardcoding
 * `main/index.cjs` + `main/chunks/*.cjs` silently missed `out/preload/chunks`,
 * which electron.vite.config.ts configures identically to main, and would miss
 * any future entry or nested chunk directory the same way.
 */
export const collectBundleFiles = (outDir: string): string[] => {
  const files: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (depth === 0 && UNSCANNED_OUT_SUBDIRS.includes(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (
        entry.isFile() &&
        BUNDLE_SCRIPT_EXTENSIONS.includes(path.extname(entry.name))
      ) {
        files.push(path.join(dir, entry.name));
      }
    }
  };

  walk(outDir, 0);
  return files.sort();
};

/** Output sink, injected so the check is testable without capturing stdout. */
export type BundleCheckIo = {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
};

const consoleIo: BundleCheckIo = {
  log: (message) => {
    console.log(message);
  },
  error: (message) => {
    console.error(message);
  },
};

/**
 * Scans every bundle under `outDir` and prints a per-file summary.
 * Returns the process exit code: 0 when clean, 1 when anything was found or
 * when `outDir` holds no bundles at all (a missing build must not pass).
 */
export const runBundleExternalsCheck = (
  outDir: string,
  io: BundleCheckIo = consoleIo,
): number => {
  const files = collectBundleFiles(outDir);

  if (files.length === 0) {
    io.error(
      `check-bundle-externals: no bundle files found under ${outDir}. Run \`bun run build\` first.`,
    );
    return 1;
  }

  io.log("Bundle externals check");
  io.log("=======================");

  let total = 0;
  for (const file of files) {
    const relPath = path.relative(process.cwd(), file);
    const violations = scanBundleSource(readFileSync(file, "utf8"), relPath);
    total += violations.length;

    const status = violations.length === 0 ? "OK" : `${String(violations.length)} violation(s)`;
    io.log(`  ${relPath.padEnd(40)} ${status}`);
    for (const violation of violations) {
      io.log(`    - [${violation.kind}] line ${String(violation.line)}: ${violation.detail}`);
    }
  }

  io.log("");
  if (total > 0) {
    io.log(`${String(total)} total violation(s) found.`);
    return 1;
  }

  io.log("No non-allowlisted bare specifiers or non-literal require()/import() calls found.");
  return 0;
};
