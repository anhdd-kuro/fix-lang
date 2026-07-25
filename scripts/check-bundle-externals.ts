/**
 * @file check-bundle-externals.ts
 * @description Bun-runnable guardrail CLI that AST-scans the built CJS
 * bundles (`out/main/index.cjs`, `out/preload/index.cjs`,
 * `out/main/chunks/*.cjs`) for any `require()` / dynamic `import()` call
 * that reaches outside what electron-builder actually ships: a bare
 * specifier (not a Node builtin, not `electron`, not a relative/absolute
 * path) that isn't in the allowlist, or a call whose argument isn't a
 * string literal at all.
 *
 * Why this exists: card 07 removes `node_modules` from `app.asar` entirely.
 * Today's bundles have zero bare non-builtin specifiers at call position
 * (verified by AST parse, see
 * `.scratch/package-size-reduction/evidence/02/raw-17-ast-require-scan.txt`),
 * so this guard's allowlist ships empty. It exists to catch a *future*
 * dynamic `require(someVariable)` or a new bare import before it turns into
 * a silent `MODULE_NOT_FOUND` in a shipped app.
 *
 * Uses the TypeScript compiler API (already a devDependency — no new
 * package needed) to parse the built `.cjs` files and walk real
 * `CallExpression` / dynamic-import AST nodes, not a regex. A regex would
 * also match strings like `require("ajv/dist/runtime/validation_error")`
 * that live only inside Ajv's standalone-codegen template-literal *text* —
 * never executed, see evidence/02 finding — and would "pass" forever
 * without ever proving anything. Walking the AST for actual call
 * expressions ignores that text automatically, no special-casing needed.
 *
 * Usage: bun run check:bundle   (run `bun run build` first)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type BundleViolationKind = "bare-specifier" | "non-literal-argument";

export type BundleViolation = {
  readonly file: string;
  readonly line: number;
  readonly kind: BundleViolationKind;
  readonly detail: string;
};

/**
 * Empty on purpose. Probe 02's AST scan (evidence/02) found zero bare
 * non-builtin specifiers at call position in any built bundle — the two
 * `ajv`/`ajv-formats` strings that look like requires are inert
 * template-literal text, not calls, so they never reach this allowlist.
 * Keep it empty unless a future AST scan of `out/` proves a legitimate bare
 * specifier is required at runtime.
 */
export const ALLOWLIST: readonly string[] = [];

/**
 * Deliberately NOT derived from `node:module`'s `builtinModules` /
 * `isBuiltin`. This script runs under `bun run`, and Bun's own
 * implementation of that list is Bun-flavored, not Node's: it is missing
 * real Node-only-prefixed builtins the bundle actually requires (notably
 * `node:sqlite` — verified by hand, see below), and it adds Bun-only
 * entries (`bun:sqlite`, `bun:test`, `ws`, `undici`) that are not Node core
 * modules at all. Trusting it would either miss a real violation or flag a
 * legitimate builtin. This is the stable, documented set of Node core
 * modules loadable via their bare (unprefixed) name; anything requiring the
 * mandatory `node:` prefix (e.g. `node:sqlite`, `node:test`, `node:sea`) is
 * handled separately below by trusting the prefix itself, since `node:` is a
 * reserved URL scheme no npm package can occupy.
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

const isRelativeOrAbsolute = (specifier: string): boolean =>
  specifier.startsWith(".") || specifier.startsWith("/");

const isBuiltinOrElectron = (specifier: string): boolean =>
  specifier === "electron" ||
  specifier.startsWith("node:") ||
  BARE_BUILTIN_NAMES.has(specifier);

const isBareSpecifier = (specifier: string): boolean =>
  !isRelativeOrAbsolute(specifier) && !isBuiltinOrElectron(specifier);

/** `require(...)` or `require.resolve(...)`. */
const isRequireLikeCall = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) return false;
  const { expression } = node;
  if (ts.isIdentifier(expression) && expression.text === "require") {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    !expression.questionDotToken &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "require" &&
    expression.name.text === "resolve"
  );
};

/** Dynamic `import(...)`, distinct from a static `import` declaration. */
const isDynamicImportCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;

const lineOf = (sourceFile: ts.SourceFile, pos: number): number =>
  sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

/**
 * Scans one bundle's source text for require()/import() calls and returns
 * every violation: a call whose argument is not a string literal, or a
 * literal bare specifier that is not a builtin, "electron", a
 * relative/absolute path, or explicitly allowlisted.
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
  const violations: BundleViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (isRequireLikeCall(node) || isDynamicImportCall(node)) {
      const [arg] = node.arguments;
      if (arg !== undefined) {
        if (ts.isStringLiteralLike(arg)) {
          const specifier = arg.text;
          if (isBareSpecifier(specifier) && !allowlist.includes(specifier)) {
            violations.push({
              file: fileLabel,
              line: lineOf(sourceFile, node.getStart(sourceFile)),
              kind: "bare-specifier",
              detail: specifier,
            });
          }
        } else {
          violations.push({
            file: fileLabel,
            line: lineOf(sourceFile, node.getStart(sourceFile)),
            kind: "non-literal-argument",
            detail: node.getText(sourceFile).slice(0, 120),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

const resolveOutDir = (): string => {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(scriptsDir, "..", "out");
};

const collectBundleFiles = (outDir: string): string[] => {
  const files: string[] = [];

  const mainIndex = path.join(outDir, "main", "index.cjs");
  if (existsSync(mainIndex)) files.push(mainIndex);

  const preloadIndex = path.join(outDir, "preload", "index.cjs");
  if (existsSync(preloadIndex)) files.push(preloadIndex);

  const chunksDir = path.join(outDir, "main", "chunks");
  if (existsSync(chunksDir)) {
    for (const entry of readdirSync(chunksDir).sort()) {
      if (entry.endsWith(".cjs")) {
        files.push(path.join(chunksDir, entry));
      }
    }
  }

  return files;
};

const printSummary = (
  files: readonly string[],
  violationsByFile: ReadonlyMap<string, BundleViolation[]>,
): void => {
  console.log("Bundle externals check");
  console.log("=======================");
  for (const file of files) {
    const relPath = path.relative(process.cwd(), file);
    const violations = violationsByFile.get(file) ?? [];
    const status = violations.length === 0 ? "OK" : `${String(violations.length)} violation(s)`;
    console.log(`  ${relPath.padEnd(40)} ${status}`);
    for (const violation of violations) {
      console.log(`    - [${violation.kind}] line ${String(violation.line)}: ${violation.detail}`);
    }
  }
};

const main = (): void => {
  const outDir = resolveOutDir();
  const files = collectBundleFiles(outDir);

  if (files.length === 0) {
    console.error(
      `check-bundle-externals: no bundle files found under ${outDir}. Run \`bun run build\` first.`,
    );
    process.exit(1);
    return;
  }

  const violationsByFile = new Map<string, BundleViolation[]>();
  let total = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const violations = scanBundleSource(source, path.relative(process.cwd(), file));
    violationsByFile.set(file, violations);
    total += violations.length;
  }

  printSummary(files, violationsByFile);

  console.log("");
  if (total > 0) {
    console.log(`${String(total)} total violation(s) found.`);
    process.exit(1);
  } else {
    console.log(
      "No non-allowlisted bare specifiers or non-literal require()/import() calls found.",
    );
  }
};

const isMainModule = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMainModule) {
  main();
}
