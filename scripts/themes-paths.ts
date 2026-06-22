/**
 * @file themes-paths.ts
 * @description Shared paths for tm-themes download and CSS generation scripts.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDir, "..");

export const THEME_JSON_DIR = path.join(projectRoot, "src/themes/json");
export const THEME_TERMINAL_JSON_DIR = path.join(
  projectRoot,
  "src/themes/json/terminal",
);
export const THEME_BRANDS_JSON_DIR = path.join(
  projectRoot,
  "src/themes/json/brands",
);

export const THEME_CSS_DIR = path.join(
  projectRoot,
  "src/renderer/themes/generated",
);
export const THEME_IMPORTS_CSS = path.join(THEME_CSS_DIR, "imports.css");
export const THEME_IDS_GENERATED = path.join(
  projectRoot,
  "src/stores/themeIds.generated.ts",
);
export const THEME_MANIFEST_GENERATED = path.join(
  projectRoot,
  "src/renderer/themes/manifest.generated.ts",
);
export const OVERLAY_HTML = path.join(
  projectRoot,
  "src/main/webViewWindows/overlay.html",
);

export const TM_THEMES_GITHUB_DIR =
  "https://api.github.com/repos/shikijs/textmate-grammars-themes/contents/packages/tm-themes/themes";

export const TERMINALCOLORS_BASE = "https://terminalcolors.com";

export const DEFAULT_THEME_ID = "brand-codex-dark";
