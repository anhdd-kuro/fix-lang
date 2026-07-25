/**
 * @file check-bundle-externals.test.ts
 * @description Negative-path proof for the bundle-externals guard. Runs the
 * scanner's core (`scanBundleSource`) against synthetic fixture source
 * strings — never against the real `out/` build output, which must not be a
 * test dependency (a missing/stale `out/` would otherwise make this suite
 * flaky or require `bun run build` before `bun run test`).
 *
 * Proves the two failure modes the guard exists for:
 *   (a) a non-allowlisted bare `require("…")` specifier is flagged, and
 *   (b) a `require(` whose argument is not a string literal is flagged.
 * Also proves the guard does NOT false-positive on builtins, `node:*`,
 * `electron`, relative/absolute paths, allowlisted specifiers, or — the
 * specific trap probe 02 found in the real bundle — a bare specifier that
 * only ever appears as inert template-literal *text*, never as an executed
 * call.
 */
import { describe, expect, it } from "vitest";
import { ALLOWLIST, scanBundleSource } from "./check-bundle-externals";

describe("scanBundleSource", () => {
  it("flags a non-allowlisted bare require() specifier", () => {
    const violations = scanBundleSource('require("left-pad");', "fixture.cjs");

    expect(violations).toEqual([
      expect.objectContaining({
        kind: "bare-specifier",
        detail: "left-pad",
      }),
    ]);
  });

  it("flags require() called with a non-literal argument", () => {
    const violations = scanBundleSource(
      "const name = computeName(); require(name);",
      "fixture.cjs",
    );

    expect(violations).toEqual([
      expect.objectContaining({ kind: "non-literal-argument" }),
    ]);
  });

  it("flags a dynamic import() with a non-literal argument", () => {
    const violations = scanBundleSource(
      "const spec = pick(); import(spec);",
      "fixture.cjs",
    );

    expect(violations).toEqual([
      expect.objectContaining({ kind: "non-literal-argument" }),
    ]);
  });

  it("does not flag Node builtins, node:-prefixed builtins, or electron", () => {
    const violations = scanBundleSource(
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
      "fixture.cjs",
    );

    expect(violations).toEqual([]);
  });

  it("does not flag relative or absolute specifiers", () => {
    const violations = scanBundleSource(
      [
        'require("./chunks/token.cjs");',
        'require("../index.cjs");',
        'require("/opt/homebrew/bin/brew");',
      ].join("\n"),
      "fixture.cjs",
    );

    expect(violations).toEqual([]);
  });

  it("does not flag a bare specifier that only appears as template-literal text", () => {
    // Mirrors the real trap found in out/main/index.cjs by probe 02: Ajv's
    // standalone codegen embeds `require("ajv/...")` as source-text inside a
    // tagged template, never as an executed call. A regex over raw text would
    // match this forever; the AST walk must not, because there is no
    // CallExpression here at all — just string data.
    const violations = scanBundleSource(
      'const code = tag`require("ajv/dist/runtime/validation_error").default`;',
      "fixture.cjs",
    );

    expect(violations).toEqual([]);
  });

  it("does not flag a bare specifier explicitly passed in the allowlist", () => {
    const violations = scanBundleSource(
      'require("some-allowlisted-pkg");',
      "fixture.cjs",
      ["some-allowlisted-pkg"],
    );

    expect(violations).toEqual([]);
  });

  it("ships with an empty default allowlist", () => {
    // Ground truth from probe 02 (evidence/02/raw-17-ast-require-scan.txt):
    // zero bare non-builtin specifiers at call position in any built bundle.
    // The allowlist exists as a mechanism, not because anything needs it today.
    expect(ALLOWLIST).toEqual([]);
  });
});
