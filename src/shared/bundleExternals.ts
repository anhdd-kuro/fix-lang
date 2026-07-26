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

/**
 * Specifiers the Electron runtime resolves itself, with no `node_modules`
 * involved. `electron` plus the four process-scoped entry points Electron's own
 * `electron.d.ts` declares (`declare module 'electron/main'`, …).
 *
 * Verified by launching a real Electron 43 main process from a directory with
 * no `node_modules` anywhere on its resolution path: all five require cleanly,
 * while `electron/nope` throws MODULE_NOT_FOUND. This is the allowlist case the
 * file header calls legitimate — "a module provided by the Electron runtime
 * itself" — so it belongs here rather than in {@link ALLOWLIST}, which exists
 * to stay empty.
 *
 * Matched exactly rather than by root segment, for the same reason
 * {@link BARE_BUILTIN_SUBPATHS} is: `electron/nope` and `electron/main/extra`
 * really would try to load from `node_modules`, and a prefix rule would wave
 * them through.
 */
const ELECTRON_RUNTIME_SPECIFIERS = new Set<string>([
  "electron",
  "electron/main",
  "electron/common",
  "electron/renderer",
  "electron/utility",
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
  ELECTRON_RUNTIME_SPECIFIERS.has(specifier) ||
  specifier.startsWith("node:") ||
  BARE_BUILTIN_NAMES.has(specifier) ||
  BARE_BUILTIN_SUBPATHS.has(specifier);

const isBareSpecifier = (specifier: string): boolean =>
  !isRelativeOrAbsolute(specifier) && !isBuiltinOrElectron(specifier);

/** Factory that hands back a CommonJS `require` function. */
const CREATE_REQUIRE = "createRequire";

/**
 * Peels the wrappers that change how an expression is *spelled* without
 * changing what it evaluates to: parentheses, and the comma (sequence)
 * operator, whose value is its right operand.
 *
 * The comma case is not exotic. `(0, f)(x)` is the standard esbuild / Rollup /
 * tsc idiom for calling `f` with `this` stripped off a member access, and
 * today's `out/main/index.cjs` contains 925 occurrences of `(0, `. Without
 * this, `(0, require)("left-pad")` is a BinaryExpression callee that matches
 * nothing and the whole scan silently stops seeing the require.
 *
 * The left operand is not lost: `visit` walks every child of every node, so a
 * require living inside the discarded half is still reached on its own.
 */
const unwrapExpression = (node: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(node)) return unwrapExpression(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return unwrapExpression(node.right);
  }
  return node;
};

/**
 * Splits a statically-known member access into its object and property name.
 * Covers both `foo.bar` and `foo["bar"]` — minifiers and property-mangler
 * configs emit the bracket form for the same access.
 *
 * A computed key (`foo[k]`) is deliberately not a member access here: there is
 * no property name to compare, and guessing would fail a release on something
 * unknowable.
 */
const memberAccess = (
  node: ts.Expression,
): { readonly object: ts.Expression; readonly name: string } | undefined => {
  if (ts.isPropertyAccessExpression(node)) {
    return { object: node.expression, name: node.name.text };
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return { object: node.expression, name: node.argumentExpression.text };
  }
  return undefined;
};

/** The property name of a `foo.bar` / `foo["bar"]` access, if it is one. */
const memberName = (node: ts.Expression): string | undefined => memberAccess(node)?.name;

/** Strips wrappers and returns the identifier name, if that is all there is. */
const identifierName = (node: ts.Expression): string | undefined => {
  const target = unwrapExpression(node);
  return ts.isIdentifier(target) ? target.text : undefined;
};

/** Local names, per file, that stand in for `require` or for `createRequire`. */
type RequireNames = {
  /** Names that evaluate to a `require` function. */
  readonly requires: ReadonlySet<string>;
  /** Names that evaluate to the `createRequire` factory. */
  readonly factories: ReadonlySet<string>;
};

/**
 * `createRequire` itself, `module.createRequire`, `Module["createRequire"]`, or
 * any local name a bundler gave the factory (`createRequire$1`, `cr`, …).
 *
 * The rename case is the whole point: the scanner already expected the
 * factory's *result* to be renamed, but matching the factory by exact
 * identifier text meant `const cr = require("node:module").createRequire`
 * silently switched the entire alias chain off.
 */
const isCreateRequireReference = (
  node: ts.Expression,
  factories: ReadonlySet<string>,
): boolean => {
  const target = unwrapExpression(node);
  const name = identifierName(target);
  return name === undefined ? memberName(target) === CREATE_REQUIRE : factories.has(name);
};

/**
 * True for an expression that is a `require` function on its own terms, with
 * no knowledge of local `require` bindings: member access ending in `.require`
 * (`module.require`, `process.mainModule.require`, `require.main.require`) or
 * an immediately-invoked `createRequire(import.meta.url)`.
 */
const isIntrinsicRequireExpression = (
  node: ts.Expression,
  factories: ReadonlySet<string>,
): boolean => {
  const target = unwrapExpression(node);
  if (memberName(target) === "require") return true;
  if (ts.isCallExpression(target)) return isCreateRequireReference(target.expression, factories);
  return false;
};

/**
 * True when `node` evaluates to a `require` function rather than merely being
 * spelled `require` — an intrinsic form, or any locally-bound alias discovered
 * by {@link collectRequireNames}.
 */
const isRequireExpression = (node: ts.Expression, names: RequireNames): boolean => {
  const name = identifierName(node);
  return name === undefined
    ? isIntrinsicRequireExpression(node, names.factories)
    : names.requires.has(name);
};

/**
 * Accumulates a set of names from direct seeds plus `name = otherName` copy
 * edges, resolved with a worklist rather than a re-walk-the-tree-until-stable
 * fixpoint. A fixpoint degrades to O(passes x nodes) when aliases appear before
 * the binding they derive from, which would let a pathological bundle hang the
 * release job — a CPU-bound scan cannot be interrupted by a CI timeout.
 */
const createAliasGraph = (
  root: string,
): {
  seed: (name: string) => void;
  link: (source: string, dependent: string) => void;
  resolve: () => ReadonlySet<string>;
} => {
  const names = new Set<string>([root]);
  /** alias source name -> names that copy it. */
  const dependents = new Map<string, string[]>();
  const pending: string[] = [root];

  const seed = (name: string): void => {
    if (names.has(name)) return;
    names.add(name);
    pending.push(name);
  };

  return {
    seed,
    link: (source, dependent) => {
      const edges = dependents.get(source);
      if (edges === undefined) {
        dependents.set(source, [dependent]);
      } else {
        edges.push(dependent);
      }
    },
    resolve: () => {
      // Each name enters `pending` at most once, so this visits every edge once.
      while (pending.length > 0) {
        const source = pending.pop();
        if (source === undefined) break;
        for (const dependent of dependents.get(source) ?? []) {
          seed(dependent);
        }
      }
      return names;
    },
  };
};

/** `name = <expr>` (no declaration keyword), anywhere in the tree. */
const plainAssignment = (
  node: ts.Node,
): { readonly name: string; readonly value: ts.Expression } | undefined =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  ts.isIdentifier(node.left)
    ? { name: node.left.text, value: node.right }
    : undefined;

/** Local names `property` is destructured into: `const { require: r } = module`. */
const destructuredAs = (pattern: ts.ObjectBindingPattern, property: string): string[] => {
  const found: string[] = [];
  for (const element of pattern.elements) {
    const key = element.propertyName ?? element.name;
    if (ts.isIdentifier(key) && key.text === property && ts.isIdentifier(element.name)) {
      found.push(element.name.text);
    }
  }
  return found;
};

/**
 * Walks every `const x = …` / `x = …` / `const { k: x } = …` binding in the
 * file and hands each one to `record`.
 *
 * NOT named `declare`, and neither is anything it calls: `bun run` (which is
 * how this ships) parses a statement-position `declare(...)` call as an ambient
 * TypeScript declaration and erases it outright, while vitest's esbuild
 * transform keeps it. That divergence silently disabled alias resolution here
 * with the whole unit suite green — see the CLI-under-bun test.
 */
const forEachBinding = (
  sourceFile: ts.SourceFile,
  record: {
    readonly initialized: (name: string, initializer: ts.Expression) => void;
    readonly destructured: (pattern: ts.ObjectBindingPattern) => void;
  },
): void => {
  const visit = (node: ts.Node): void => {
    const assignment = plainAssignment(node);
    if (ts.isVariableDeclaration(node)) {
      if (ts.isObjectBindingPattern(node.name)) {
        record.destructured(node.name);
      } else if (ts.isIdentifier(node.name) && node.initializer !== undefined) {
        record.initialized(node.name.text, node.initializer);
      }
    } else if (assignment !== undefined) {
      record.initialized(assignment.name, assignment.value);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
};

/**
 * Names bound to a require function in this file, and names bound to the
 * `createRequire` factory that produces them. Both are seeded with their
 * canonical spelling and grown across copy edges, because bundlers rename both
 * ends: the factory (`createRequire$1`, `cr`) and its result (`require$1`,
 * `req`), and hand-written code aliases `require` directly (`var r = require`,
 * `const { require: r } = module`).
 *
 * Two passes, factories first, so neither depends on declaration order —
 * hoisting and bundler output both reorder freely.
 */
const collectRequireNames = (sourceFile: ts.SourceFile): RequireNames => {
  const factoryGraph = createAliasGraph(CREATE_REQUIRE);
  forEachBinding(sourceFile, {
    initialized: (name, initializer) => {
      const target = unwrapExpression(initializer);
      if (memberName(target) === CREATE_REQUIRE) {
        factoryGraph.seed(name);
        return;
      }
      const source = identifierName(target);
      if (source !== undefined) factoryGraph.link(source, name);
    },
    destructured: (pattern) => {
      for (const name of destructuredAs(pattern, CREATE_REQUIRE)) factoryGraph.seed(name);
    },
  });
  const factories = factoryGraph.resolve();

  const requireGraph = createAliasGraph("require");
  forEachBinding(sourceFile, {
    initialized: (name, initializer) => {
      if (isIntrinsicRequireExpression(initializer, factories)) {
        requireGraph.seed(name);
        return;
      }
      const source = identifierName(initializer);
      if (source !== undefined) requireGraph.link(source, name);
    },
    destructured: (pattern) => {
      for (const name of destructuredAs(pattern, "require")) requireGraph.seed(name);
    },
  });

  return { requires: requireGraph.resolve(), factories };
};

/**
 * True for a call that resolves a module specifier: `require(…)`,
 * `require.resolve(…)`, any aliased/derived form of either, or a dynamic
 * `import(…)`.
 */
const isModuleResolvingCall = (node: ts.CallExpression, names: RequireNames): boolean => {
  const callee = unwrapExpression(node.expression);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (isRequireExpression(callee, names)) return true;
  const member = memberAccess(callee);
  return member?.name === "resolve" && isRequireExpression(member.object, names);
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
  const names = collectRequireNames(sourceFile);
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
    } else if (ts.isCallExpression(node) && isModuleResolvingCall(node, names)) {
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
