/**
 * @file download-terminalcolors.ts
 * @description Downloads Alacritty themes from terminalcolors.com and saves TmTheme JSON.
 *
 * Usage: bun run themes:download:terminal
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { alacrittyToTmTheme, parseAlacrittyToml } from "../src/themes/alacrittyToTmTheme";
import { THEME_TERMINAL_JSON_DIR, TERMINALCOLORS_BASE } from "./themes-paths";

const THEME_PAGE_PATTERN = /href="(\/themes\/[^"#?]+\/)"/g;
const ALACRITTY_DOWNLOAD_PATTERN =
  /href="(\/downloads\/alacritty\/[^"]+\.toml)"/g;
const ACCENT_PATTERN = /"accent":\[0,"(#[0-9a-fA-F]{3,8})"\]/;

type ThemeDownload = {
  downloadPath: string;
  accentHint?: string;
};

const fetchText = async (url: string): Promise<string> => {
  const response = await fetch(url, {
    headers: { "User-Agent": "fix-lang-terminalcolors-downloader" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} for ${url}`);
  }
  return response.text();
};

const unique = (values: string[]): string[] => [...new Set(values)];

const discoverThemePages = async (): Promise<string[]> => {
  const homepage = await fetchText(`${TERMINALCOLORS_BASE}/`);
  const pages = [...homepage.matchAll(THEME_PAGE_PATTERN)].map(
    (match) => match[1],
  );
  return unique(pages);
};

const discoverThemeDownloads = async (
  themePages: string[],
): Promise<ThemeDownload[]> => {
  const byPath = new Map<string, ThemeDownload>();

  for (const pagePath of themePages) {
    const html = await fetchText(`${TERMINALCOLORS_BASE}${pagePath}`);
    const accentMatch = ACCENT_PATTERN.exec(html);
    const accentHint = accentMatch?.[1];

    for (const match of html.matchAll(ALACRITTY_DOWNLOAD_PATTERN)) {
      const downloadPath = match[1];
      if (!byPath.has(downloadPath)) {
        byPath.set(downloadPath, { downloadPath, accentHint });
      }
    }
  }

  return [...byPath.values()];
};

const main = async (): Promise<void> => {
  await mkdir(THEME_TERMINAL_JSON_DIR, { recursive: true });

  const themePages = await discoverThemePages();
  const downloads = await discoverThemeDownloads(themePages);

  if (downloads.length === 0) {
    throw new Error("No Alacritty downloads found on terminalcolors.com");
  }

  let saved = 0;

  for (const entry of downloads) {
    const slug = path.basename(entry.downloadPath, ".toml");
    const themeId = `tc-${slug}`;

    const toml = await fetchText(`${TERMINALCOLORS_BASE}${entry.downloadPath}`);
    const palette = parseAlacrittyToml(toml);
    const theme = alacrittyToTmTheme(slug, palette, entry.accentHint);
    theme.name = themeId;
    theme.displayName = `${theme.displayName ?? slug} (Terminal)`;

    const destination = path.join(THEME_TERMINAL_JSON_DIR, `${themeId}.json`);
    await writeFile(destination, `${JSON.stringify(theme, null, 2)}\n`, "utf8");
    saved += 1;
  }

  console.log(
    `Downloaded ${String(saved)} terminal themes to ${THEME_TERMINAL_JSON_DIR}`,
  );
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Terminal theme download failed: ${message}`);
  process.exit(1);
});
