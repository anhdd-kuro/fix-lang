/**
 * @file generate-theme-css.ts
 * @description Converts tm-themes JSON files to CSS preset files and generated manifests.
 *
 * Usage: bun run themes:generate
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmThemeToSemanticTokens } from "../src/themes/tmThemeToSemanticTokens";
import type { SemanticTokenKey, TmTheme } from "../src/themes/tmThemeTypes";
import {
  DEFAULT_THEME_ID,
  OVERLAY_HTML,
  THEME_CSS_DIR,
  THEME_IDS_GENERATED,
  THEME_IMPORTS_CSS,
  THEME_JSON_DIR,
  THEME_BRANDS_JSON_DIR,
  THEME_MANIFEST_GENERATED,
  THEME_TERMINAL_JSON_DIR,
} from "./themes-paths";

type ThemeEntry = {
  id: string;
  label: string;
  type: "dark" | "light";
  tokens: ReturnType<typeof tmThemeToSemanticTokens>;
};

const SEMANTIC_KEYS = Object.keys(
  tmThemeToSemanticTokens({ name: "fallback", colors: {} }),
) as SemanticTokenKey[];

const toCssBlock = (selector: string, tokens: ThemeEntry["tokens"]): string => {
  const lines = SEMANTIC_KEYS.map(
    (key) => `  ${key}: ${tokens[key]};`,
  );
  return `${selector} {\n${lines.join("\n")}\n}`;
};

const themeSelector = (id: string, isDefault: boolean): string => {
  if (isDefault) {
    return [
      "html:not([data-theme])",
      'html[data-theme="default"]',
      `html[data-theme="${id}"]`,
    ].join(",\n");
  }

  return `html[data-theme="${id}"]`;
};

const toPresetCss = (entry: ThemeEntry, isDefault: boolean): string => {
  const header = `/**\n * Auto-generated from ${entry.id}.json — do not edit.\n * Run \`bun run themes:generate\` to regenerate.\n */`;

  return [
    header,
    toCssBlock(themeSelector(entry.id, isDefault), entry.tokens),
  ].join("\n\n");
};

const overlaySelector = (id: string, isDefault: boolean): string => {
  if (isDefault) {
    return [
      "html:not([data-theme])",
      'html[data-theme="default"]',
      `html[data-theme="${id}"]`,
    ].join(",\n    ");
  }

  return `html[data-theme="${id}"]`;
};

const toOverlayStyles = (entries: ThemeEntry[]): string => {
  const blocks = entries.map((entry) => {
    const isDefault = entry.id === DEFAULT_THEME_ID;
    const selector = overlaySelector(entry.id, isDefault);

    return `    ${selector} {
      --border-width: 4px;
      --overlay-spinner: ${entry.tokens["--overlay-spinner"]};
      --overlay-spinner-track: ${entry.tokens["--overlay-spinner-track"]};
    }`;
  });

  return blocks.join("\n\n");
};

const patchOverlayHtml = async (overlayStyles: string): Promise<void> => {
  const html = await readFile(OVERLAY_HTML, "utf8");
  const startMarker = "    /* GENERATED_OVERLAY_THEMES_START */";
  const endMarker = "    /* GENERATED_OVERLAY_THEMES_END */";

  const startIndex = html.indexOf(startMarker);
  const endIndex = html.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(
      "overlay.html is missing GENERATED_OVERLAY_THEMES markers — cannot patch",
    );
  }

  const before = html.slice(0, startIndex + startMarker.length);
  const after = html.slice(endIndex);
  const patched = `${before}\n${overlayStyles}\n${after}`;

  await writeFile(OVERLAY_HTML, patched, "utf8");
};

const generateThemeIdsFile = async (entries: ThemeEntry[]): Promise<void> => {
  const ids = entries.map((entry) => entry.id);
  const idsLiteral = ids.map((id) => `  "${id}",`).join("\n");

  const content = `/**
 * AUTO-GENERATED — do not edit.
 * Run \`bun run themes:generate\` to regenerate.
 */

export const THEME_IDS = [
${idsLiteral}
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "${DEFAULT_THEME_ID}";

/**
 * Type guard for theme IDs received over IPC.
 */
export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
`;

  await writeFile(THEME_IDS_GENERATED, content, "utf8");
};

const generateManifestFile = async (entries: ThemeEntry[]): Promise<void> => {
  const presets = entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: themeDescription(entry.id, entry.type),
    swatch: {
      background: entry.tokens["--background"],
      primary: entry.tokens["--primary"],
      accent: entry.tokens["--accent"],
    },
  }));

  const content = `/**
 * AUTO-GENERATED — do not edit.
 * Run \`bun run themes:generate\` to regenerate.
 */
import type { ThemeId } from "~/stores/themeIds";

export type ThemePreset = {
  id: ThemeId;
  label: string;
  description: string;
  swatch: {
    background: string;
    primary: string;
    accent: string;
  };
};

export const THEME_PRESETS: readonly ThemePreset[] = ${JSON.stringify(presets, null, 2)} as const;
`;

  await writeFile(THEME_MANIFEST_GENERATED, content, "utf8");
};

const themeDescription = (id: string, type: "dark" | "light"): string => {
  if (id.startsWith("brand-")) {
    return "Brand theme";
  }
  if (id.startsWith("tc-")) {
    return type === "light" ? "Terminal · Light" : "Terminal · Dark";
  }
  return type === "light" ? "Shiki · Light" : "Shiki · Dark";
};

const loadThemeEntries = async (): Promise<ThemeEntry[]> => {
  const sourceFiles: Array<{ id: string; filePath: string }> = [];

  const shikiFiles = (await readdir(THEME_JSON_DIR))
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of shikiFiles) {
    sourceFiles.push({
      id: file.replace(/\.json$/, ""),
      filePath: path.join(THEME_JSON_DIR, file),
    });
  }

  for (const dir of [THEME_TERMINAL_JSON_DIR, THEME_BRANDS_JSON_DIR]) {
    let files: string[] = [];
    try {
      files = (await readdir(dir))
        .filter((file) => file.endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      files = [];
    }

    for (const file of files) {
      sourceFiles.push({
        id: file.replace(/\.json$/, ""),
        filePath: path.join(dir, file),
      });
    }
  }

  if (sourceFiles.length === 0) {
    throw new Error("No JSON themes found in theme source directories");
  }

  const entries: ThemeEntry[] = [];

  for (const source of sourceFiles) {
    const raw = await readFile(source.filePath, "utf8");
    const theme = JSON.parse(raw) as TmTheme;
    const tokens = tmThemeToSemanticTokens(theme);
    const type = theme.type === "light" ? "light" : "dark";

    entries.push({
      id: source.id,
      label: theme.displayName ?? theme.name ?? source.id,
      type,
      tokens,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));

  if (!entries.some((entry) => entry.id === DEFAULT_THEME_ID)) {
    throw new Error(
      `Default theme "${DEFAULT_THEME_ID}" not found in theme sources`,
    );
  }

  return entries;
};

const main = async (): Promise<void> => {
  await mkdir(THEME_CSS_DIR, { recursive: true });

  const entries = await loadThemeEntries();
  const importLines: string[] = [];

  for (const entry of entries) {
    const cssFileName = `preset-${entry.id}.css`;
    const cssPath = path.join(THEME_CSS_DIR, cssFileName);
    const isDefault = entry.id === DEFAULT_THEME_ID;

    await writeFile(
      cssPath,
      `${toPresetCss(entry, isDefault)}\n`,
      "utf8",
    );
    importLines.push(`@import "./${cssFileName}";`);
  }

  const importsContent = `/**
 * AUTO-GENERATED — do not edit.
 * Run \`bun run themes:generate\` to regenerate.
 */
${importLines.join("\n")}
`;

  await writeFile(THEME_IMPORTS_CSS, importsContent, "utf8");
  await generateThemeIdsFile(entries);
  await generateManifestFile(entries);
  await patchOverlayHtml(toOverlayStyles(entries));

  console.log(
    `Generated ${String(entries.length)} theme CSS files in ${THEME_CSS_DIR}`,
  );
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Theme generation failed: ${message}`);
  process.exit(1);
});
