/**
 * @file generate-theme-css.test.ts
 * @description Ensures generated theme CSS selectors do not leak default tokens globally.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const generatedDir = path.join(
  import.meta.dirname,
  "../src/renderer/themes/generated",
);
const projectRoot = path.join(import.meta.dirname, "..");
const themeJsonDir = path.join(projectRoot, "src/themes/json");
const themeSourceDirectories = [
  themeJsonDir,
  path.join(themeJsonDir, "brands"),
  path.join(themeJsonDir, "terminal"),
] as const;

// This is intentionally independent from SemanticTokenKey and the derivation.
// A production deletion must leave this expected public CSS contract intact.
const canonicalSemanticKeys = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--primary-hover",
  "--primary-active",
  "--secondary",
  "--secondary-foreground",
  "--secondary-hover",
  "--secondary-active",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--destructive-hover",
  "--destructive-active",
  "--border",
  "--control-border",
  "--card-control-border",
  "--input",
  "--ring",
  "--success",
  "--success-foreground",
  "--warning",
  "--warning-foreground",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--overlay-spinner",
  "--overlay-spinner-track",
  "--overlay-backdrop",
] as const;

const interactionThemeContract = [
  {
    token: "--primary-hover",
    themeVariable: "--color-primary-hover",
    utility: "bg-primary-hover",
  },
  {
    token: "--primary-active",
    themeVariable: "--color-primary-active",
    utility: "bg-primary-active",
  },
  {
    token: "--secondary-hover",
    themeVariable: "--color-secondary-hover",
    utility: "bg-secondary-hover",
  },
  {
    token: "--secondary-active",
    themeVariable: "--color-secondary-active",
    utility: "bg-secondary-active",
  },
  {
    token: "--destructive-hover",
    themeVariable: "--color-destructive-hover",
    utility: "bg-destructive-hover",
  },
  {
    token: "--destructive-active",
    themeVariable: "--color-destructive-active",
    utility: "bg-destructive-active",
  },
] as const;

const interactionKeys = interactionThemeContract.map(({ token }) => token);

const generatedPresetFiles = (): string[] =>
  readdirSync(generatedDir)
    .filter((file) => /^preset-.+\.css$/.test(file))
    .sort((a, b) => a.localeCompare(b));

const generatedPresetIds = (): string[] =>
  generatedPresetFiles()
    .map((file) => file.replace(/^preset-/, "").replace(/\.css$/, ""))
    .sort((a, b) => a.localeCompare(b));

const sourceThemeFiles = (): string[] =>
  themeSourceDirectories.flatMap((directory) =>
    readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(directory, file)),
  );

const sourceThemeIds = (): string[] =>
  sourceThemeFiles()
    .map((file) => path.basename(file, ".json"))
    .sort((a, b) => a.localeCompare(b));

const sourceThemeFileCount = (directory: string): number =>
  readdirSync(directory).filter((file) => file.endsWith(".json")).length;

const generatedPresetHashes = (): Record<string, string> =>
  Object.fromEntries(
    generatedPresetFiles().map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(path.join(generatedDir, file)))
        .digest("hex"),
    ]),
  );

const generateThemes = (): void => {
  execFileSync("bun", ["run", "themes:generate"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
};

const buildRenderer = (): void => {
  execFileSync("bun", ["run", "build"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
};

const cssDeclarations = (css: string): Map<string, string[]> => {
  const declarations = new Map<string, string[]>();
  for (const [, key, value] of css.matchAll(/\s+(--[\w-]+):\s*([^;]+);/g)) {
    const values = declarations.get(key) ?? [];
    values.push(value.trim());
    declarations.set(key, values);
  }
  return declarations;
};

const assertGeneratedSemanticContract = (): void => {
  const presets = generatedPresetFiles();
  expect(sourceThemeFileCount(themeJsonDir)).toBe(65);
  expect(sourceThemeFileCount(path.join(themeJsonDir, "brands"))).toBe(4);
  expect(sourceThemeFileCount(path.join(themeJsonDir, "terminal"))).toBe(80);
  expect(sourceThemeFiles()).toHaveLength(149);
  expect(presets).toHaveLength(149);
  expect(generatedPresetIds()).toEqual(sourceThemeIds());

  for (const preset of presets) {
    const declarations = cssDeclarations(
      readFileSync(path.join(generatedDir, preset), "utf8"),
    );

    expect([...declarations.keys()].sort()).toEqual(
      [...canonicalSemanticKeys].sort(),
    );
    for (const key of canonicalSemanticKeys) {
      expect(declarations.get(key)).toHaveLength(1);
    }
    for (const key of interactionKeys) {
      expect(declarations.get(key)?.[0]).toMatch(/^#[\da-f]{6}$/i);
    }
  }
};

const inlineThemeDeclarations = (): string => {
  const mainCss = readFileSync(
    path.join(projectRoot, "src/renderer/main.css"),
    "utf8",
  );
  const block = mainCss.match(/@theme inline \{([\s\S]*?)\n\}/);

  expect(block?.[1]).toBeDefined();
  return block?.[1] ?? "";
};

const compiledRendererCss = (): string => {
  const rendererDir = path.join(projectRoot, "out/renderer");
  const files = readdirSync(rendererDir).filter((file) => file.endsWith(".css"));

  expect(files.length).toBeGreaterThan(0);
  return files
    .map((file) => readFileSync(path.join(rendererDir, file), "utf8"))
    .join("\n");
};

describe("generated theme CSS selectors", () => {
  it("does not emit :root blocks that override non-default themes", () => {
    const defaultCss = readFileSync(
      path.join(generatedDir, "preset-brand-codex-dark.css"),
      "utf8",
    );

    expect(defaultCss).not.toMatch(/:root/);
    expect(defaultCss).toContain("html:not([data-theme])");
    expect(defaultCss).toContain('html[data-theme="brand-codex-dark"]');
  });

  it("scopes non-default themes to html[data-theme]", () => {
    const ayuDarkCss = readFileSync(
      path.join(generatedDir, "preset-ayu-dark.css"),
      "utf8",
    );
    const lightPlusCss = readFileSync(
      path.join(generatedDir, "preset-light-plus.css"),
      "utf8",
    );

    expect(ayuDarkCss).toContain('html[data-theme="ayu-dark"]');
    expect(lightPlusCss).toContain('html[data-theme="light-plus"]');
  });

  it("regenerates and verifies the canonical opaque semantic contract for all 149 presets", () => {
    generateThemes();
    assertGeneratedSemanticContract();
  });

  it("removes stale presets so generation exactly mirrors source IDs", () => {
    const stalePreset = path.join(
      generatedDir,
      "preset-card-02-stale-source.css",
    );
    writeFileSync(stalePreset, "/* stale card-02 regression fixture */\n");

    try {
      generateThemes();
      expect(existsSync(stalePreset)).toBe(false);
      assertGeneratedSemanticContract();
    } finally {
      if (existsSync(stalePreset)) {
        unlinkSync(stalePreset);
      }
    }
  });

  it("generates byte-identical preset CSS on consecutive runs", () => {
    generateThemes();
    const firstHashes = generatedPresetHashes();

    generateThemes();
    expect(generatedPresetHashes()).toEqual(firstHashes);
    assertGeneratedSemanticContract();
  });

  it("bridges every button interaction token through Tailwind and emits its utility", () => {
    const declarations = inlineThemeDeclarations();

    for (const { token, themeVariable } of interactionThemeContract) {
      const mapping = new RegExp(
        `^\\s*${themeVariable}:\\s*var\\(${token}\\);\\s*$`,
        "gm",
      );
      expect([...declarations.matchAll(mapping)]).toHaveLength(1);
    }

    buildRenderer();
    const css = compiledRendererCss();
    for (const { token, utility } of interactionThemeContract) {
      expect(css).toMatch(
        new RegExp(
          `${utility}[^\\{]*\\{\\s*background-color:\\s*var\\(${token}\\);`,
        ),
      );
    }
  });
});
