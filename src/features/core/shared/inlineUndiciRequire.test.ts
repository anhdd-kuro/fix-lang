import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_UNDICI_BINDING,
  inlineUndiciCreateRequire,
  inlineUndiciRequirePlugin,
} from "./inlineUndiciRequire";

const IMPORT_LINE = `import * as ${BUNDLED_UNDICI_BINDING} from "undici";`;

describe("inlineUndiciCreateRequire", () => {
  it("rewrites the @ai-sdk/provider-utils >= 5.0.16 form", () => {
    const code =
      'const { Agent, fetch } = module.createRequire(getCurrentModulePath())("undici");';

    expect(inlineUndiciCreateRequire(code)).toBe(
      `${IMPORT_LINE}\nconst { Agent, fetch } = ${BUNDLED_UNDICI_BINDING};`,
    );
  });

  it("rewrites the multi-line destructured createRequire form", () => {
    const code = [
      '  const { createRequire } = loadBuiltinModule("node:module");',
      "  const { Agent, fetch } = createRequire(getCurrentModulePath())(",
      '    "undici"',
      "  );",
    ].join("\n");

    const rewritten = inlineUndiciCreateRequire(code);

    expect(rewritten).toContain(`const { Agent, fetch } = ${BUNDLED_UNDICI_BINDING};`);
    expect(rewritten?.startsWith(IMPORT_LINE)).toBe(true);
    expect(rewritten).not.toMatch(/createRequire\([^)]*\)\)\(/);
  });

  it("rewrites every occurrence in one module", () => {
    const call = "createRequire(here())('undici')";
    const rewritten = inlineUndiciCreateRequire(`a = ${call}; b = ${call};`);

    expect(rewritten).toBe(
      `${IMPORT_LINE}\na = ${BUNDLED_UNDICI_BINDING}; b = ${BUNDLED_UNDICI_BINDING};`,
    );
  });

  it("leaves modules without an undici createRequire untouched", () => {
    expect(inlineUndiciCreateRequire('import { Agent } from "undici";')).toBeNull();
    expect(inlineUndiciCreateRequire('createRequire(here())("left-pad")')).toBeNull();
    expect(inlineUndiciCreateRequire("const x = 1;")).toBeNull();
  });
});

describe("inlineUndiciRequirePlugin", () => {
  const transform = (code: string, id: string): unknown => {
    const plugin = inlineUndiciRequirePlugin();
    const hook = plugin.transform as (code: string, id: string) => unknown;
    return hook.call({}, code, id);
  };
  const hostile = 'x = module.createRequire(getCurrentModulePath())("undici");';

  it("only touches modules resolved from node_modules", () => {
    expect(transform(hostile, "/repo/src/main/index.ts")).toBeNull();
    expect(
      transform(hostile, "/repo/node_modules/@ai-sdk/provider-utils/dist/index.js"),
    ).toEqual({
      code: `${IMPORT_LINE}\nx = ${BUNDLED_UNDICI_BINDING};`,
      map: null,
    });
  });

  it("runs before other plugins", () => {
    expect(inlineUndiciRequirePlugin().enforce).toBe("pre");
  });
});

/**
 * Regression guard for dependency bumps: every installed dist that loads
 * undici through createRequire must still match the rewrite, or the next
 * build ships a bare `undici` require (caught later by `check:bundle`).
 */
describe("installed dependencies that createRequire undici", () => {
  const resolveFromRepo = createRequire(import.meta.url);
  const LOOSE_UNDICI_CREATE_REQUIRE = /createRequire\([\s\S]{0,120}?\)\(\s*["']undici["']\s*\)/;

  it.each(["@ai-sdk/provider-utils", "@openrouter/ai-sdk-provider"])(
    "%s is fully rewritten",
    (specifier) => {
      const code = readFileSync(resolveFromRepo.resolve(specifier), "utf8");
      expect(code).toMatch(LOOSE_UNDICI_CREATE_REQUIRE);

      const rewritten = inlineUndiciCreateRequire(code);

      expect(rewritten).not.toBeNull();
      expect(rewritten).not.toMatch(LOOSE_UNDICI_CREATE_REQUIRE);
    },
  );
});
