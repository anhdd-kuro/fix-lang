/**
 * @file download-themes.ts
 * @description Downloads all tm-themes JSON files from shikijs/textmate-grammars-themes.
 *
 * Usage: bun run themes:download
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { THEME_JSON_DIR, TM_THEMES_GITHUB_DIR } from "./themes-paths";

const GitHubContentEntrySchema = z.object({
  name: z.string(),
  type: z.string(),
  download_url: z.string().nullable(),
});

type GitHubContentEntry = z.infer<typeof GitHubContentEntrySchema>;

const fetchJson = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "fix-lang-theme-downloader",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error ${String(response.status)} for ${url}`);
  }

  return schema.parse(await response.json());
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

  const entries = await fetchJson(
    TM_THEMES_GITHUB_DIR,
    z.array(GitHubContentEntrySchema),
  );
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

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`Theme download failed: ${message}`);
  process.exit(1);
});
