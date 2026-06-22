/**
 * @file download-themes.ts
 * @description Downloads all tm-themes JSON files from shikijs/textmate-grammars-themes.
 *
 * Usage: bun run themes:download
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  THEME_JSON_DIR,
  TM_THEMES_GITHUB_DIR,
} from "./themes-paths";

type GitHubContentEntry = {
  name: string;
  type: string;
  download_url: string | null;
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "fix-lang-theme-downloader",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error ${String(response.status)} for ${url}`);
  }

  return (await response.json()) as T;
};

const downloadThemeFile = async (entry: GitHubContentEntry): Promise<void> => {
  if (entry.type !== "file" || !entry.name.endsWith(".json")) {
    return;
  }

  if (!entry.download_url) {
    throw new Error(`Missing download_url for ${entry.name}`);
  }

  const rawResponse = await fetch(entry.download_url);
  if (!rawResponse.ok) {
    throw new Error(
      `Failed to download ${entry.name}: ${String(rawResponse.status)}`,
    );
  }

  const content = await rawResponse.text();
  const destination = path.join(THEME_JSON_DIR, entry.name);
  await writeFile(destination, content, "utf8");
};

const main = async (): Promise<void> => {
  await mkdir(THEME_JSON_DIR, { recursive: true });

  const entries = await fetchJson<GitHubContentEntry[]>(TM_THEMES_GITHUB_DIR);
  const jsonEntries = entries.filter(
    (entry) => entry.type === "file" && entry.name.endsWith(".json"),
  );

  if (jsonEntries.length === 0) {
    throw new Error("No theme JSON files found in GitHub directory listing");
  }

  await Promise.all(jsonEntries.map((entry) => downloadThemeFile(entry)));

  console.log(
    `Downloaded ${String(jsonEntries.length)} themes to ${THEME_JSON_DIR}`,
  );
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Theme download failed: ${message}`);
  process.exit(1);
});
