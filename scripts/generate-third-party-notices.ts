/**
 * @file generate-third-party-notices.ts
 * @description Regenerates resources/THIRD-PARTY-NOTICES.md (inventory) and
 * resources/THIRD-PARTY-LICENSES.txt (verbatim licence texts, deduplicated).
 *
 * Usage: bun run notices:generate
 *
 * The package set is the full runtime dependency *closure*, not just the
 * top-level `dependencies` entries: the packaged app ships no node_modules, so
 * Vite inlines transitive modules into out/ too, and their notices have to travel
 * with the binary. The closure over-includes (Vite tree-shakes some out) because
 * crediting a dropped package is harmless while omitting a shipped one is not.
 *
 * The release workflow asserts both generated files are present inside app.asar.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `bun install` may hoist into a parent when this repo is a git worktree, so
// module resolution starts wherever node_modules actually exists.
const modulesRoot = ((): string => {
  let dir = projectRoot;
  for (;;) {
    if (existsSync(path.join(dir, "node_modules"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("no node_modules found — run `bun install` first");
    dir = parent;
  }
})();
const worktree = projectRoot;

const TM_THEMES_NOTICE_URL =
  "https://raw.githubusercontent.com/shikijs/textmate-grammars-themes/main/packages/tm-themes/NOTICE";
const APACHE_2_0_URL = "https://www.apache.org/licenses/LICENSE-2.0.txt";

const fetchText = async (url: string): Promise<string> => {
  const response = await fetch(url, { headers: { "User-Agent": "fix-lang-notices-generator" } });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${url}`);
  return response.text();
};

const upstreamThemeNotice = await fetchText(TM_THEMES_NOTICE_URL);
const apacheLicenseText = await fetchText(APACHE_2_0_URL);

/* ------------------------------- themes ---------------------------------- */

type ThemeEntry = { file: string; license: string; spdx: string; copyright: string };

const parseNotice = (raw: string): Map<string, ThemeEntry> => {
  const byFile = new Map<string, ThemeEntry>();
  for (const block of raw.split(/^=+$/m)) {
    const files = /^Files:\s+(.+)$/m.exec(block)?.[1]?.trim();
    const license = /^License:\s+(.+)$/m.exec(block)?.[1]?.trim() ?? "";
    const spdx = /^SPDX:\s+(.+)$/m.exec(block)?.[1]?.trim();
    if (!files || !spdx) continue;
    const copyright = [...block.matchAll(/^(Copyright.*)$/gm)].map((m) => m[1].trim()).join(" / ");
    for (const f of files.split(/[,\s]+/).filter(Boolean)) {
      byFile.set(f, { file: f, license, spdx, copyright });
    }
  }
  return byFile;
};

const notice = parseNotice(upstreamThemeNotice);
const themeDir = path.join(worktree, "src/themes/json");

const shikiThemes = readdirSync(themeDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const hit = notice.get(f);
    if (!hit) throw new Error(`no upstream NOTICE entry for ${f}`);
    return hit;
  });
const terminalThemes = readdirSync(path.join(themeDir, "terminal")).filter((f) => f.endsWith(".json")).sort();
const brandThemes = readdirSync(path.join(themeDir, "brands")).filter((f) => f.endsWith(".json")).sort();

/* --------------------------- package closure ----------------------------- */

type Pkg = {
  name: string;
  version: string;
  spdx: string;
  url: string;
  texts: { filename: string; body: string }[];
};

const readJson = (p: string): Record<string, unknown> =>
  JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

const resolvePkg = (name: string, fromDir: string): string | null => {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const spdxOf = (meta: Record<string, unknown>): string => {
  const lic = meta.license;
  if (typeof lic === "string") return lic;
  if (lic && typeof lic === "object" && "type" in lic) return String((lic as { type?: string }).type ?? "UNKNOWN");
  const licenses = meta.licenses;
  if (Array.isArray(licenses) && licenses.length > 0) {
    return licenses
      .map((l) => (typeof l === "string" ? l : String((l as { type?: string }).type ?? "?")))
      .join(" OR ");
  }
  return "UNKNOWN";
};

const urlOf = (meta: Record<string, unknown>): string => {
  const repo = meta.repository;
  const raw =
    typeof repo === "string" ? repo : ((repo as { url?: string } | undefined)?.url ?? String(meta.homepage ?? ""));
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
};

const licenseTextsIn = (dir: string): { filename: string; body: string }[] => {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort();
  } catch {
    return [];
  }
  const out: { filename: string; body: string }[] = [];
  for (const f of names) {
    try {
      const body = readFileSync(path.join(dir, f), "utf8").trim();
      if (body.length > 0) out.push({ filename: f, body });
    } catch {
      /* directory or unreadable entry — skip */
    }
  }
  return out;
};

const rootPkg = readJson(path.join(worktree, "package.json"));
const seeds = [
  ...Object.keys((rootPkg.dependencies ?? {}) as Record<string, string>),
  "@openrouter/ai-sdk-provider",
  "ai",
  "react-select",
  "tailwind-merge",
  "colord",
];

const found = new Map<string, Pkg>();
const unresolved = new Set<string>();
const queue = seeds.map((n) => ({ name: n, from: modulesRoot }));

while (queue.length > 0) {
  const { name, from } = queue.shift() as { name: string; from: string };
  const pj = resolvePkg(name, from);
  if (pj === null) {
    unresolved.add(name);
    continue;
  }
  const dir = path.dirname(pj);
  const meta = readJson(pj);
  const version = String(meta.version ?? "?");
  const key = `${name}@${version}`;
  if (found.has(key)) continue;
  found.set(key, { name, version, spdx: spdxOf(meta), url: urlOf(meta), texts: licenseTextsIn(dir) });
  for (const dep of Object.keys((meta.dependencies ?? {}) as Record<string, string>)) {
    queue.push({ name: dep, from: dir });
  }
}

if (unresolved.size > 0) throw new Error(`unresolved packages: ${[...unresolved].join(", ")}`);

const packages = [...found.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);

const tally = (values: string[]): string => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${String(v)} × ${k}`)
    .join(", ");
};

/* ---------------------- THIRD-PARTY-LICENSES.txt ------------------------- */

const digest = (s: string): string =>
  createHash("sha256").update(s.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim()).digest("hex");

const groups = new Map<string, { body: string; filename: string; owners: string[] }>();
const withoutText: Pkg[] = [];

for (const p of packages) {
  if (p.texts.length === 0) {
    withoutText.push(p);
    continue;
  }
  for (const t of p.texts) {
    const key = digest(t.body);
    const existing = groups.get(key);
    if (existing) existing.owners.push(`${p.name}@${p.version}`);
    else groups.set(key, { body: t.body, filename: t.filename, owners: [`${p.name}@${p.version}`] });
  }
}

const orderedGroups = [...groups.values()].sort(
  (a, b) => b.owners.length - a.owners.length || a.owners[0].localeCompare(b.owners[0]),
);

const lic: string[] = [];
const L = (s = ""): void => void lic.push(s);

L("FIXLANG — THIRD-PARTY LICENCE TEXTS");
L("===================================");
L();
L("FixLang is licensed under GPL-3.0-or-later; its licence is in LICENSE.md,");
L("distributed alongside this file.");
L();
L("This file reproduces the licence texts of the third-party packages compiled");
L("into FixLang. It exists because the packaged app ships no node_modules");
L("directory, so the original LICENSE files of those packages are not otherwise");
L("present — while MIT requires its notice to accompany substantial portions, and");
L("Apache-2.0 section 4(a) requires recipients to receive a copy of the licence.");
L();
L(`Packages covered: ${String(packages.length)} (the full runtime dependency closure).`);
L(`Licences: ${tally(packages.map((p) => p.spdx))}.`);
L();
L("Identical licence texts are reproduced once and shared, with every package");
L("they cover listed above the text. Theme and other non-npm attribution lives in");
L("THIRD-PARTY-NOTICES.md.");
L();

let n = 0;
for (const g of orderedGroups) {
  n += 1;
  L();
  L("".padEnd(78, "-"));
  L(`[${String(n)}] ${g.filename} — applies to ${String(g.owners.length)} package(s):`);
  L();
  for (const o of g.owners.sort()) L(`    ${o}`);
  L("".padEnd(78, "-"));
  L();
  L(g.body);
  L();
}

if (withoutText.length > 0) {
  L();
  L("".padEnd(78, "="));
  L("PACKAGES SHIPPING NO LICENCE FILE");
  L("".padEnd(78, "="));
  L();
  L("These packages declare a licence in package.json but ship no licence file.");
  L("The canonical text of the declared licence follows this section.");
  L();
  for (const p of withoutText) L(`    ${p.name}@${p.version} — ${p.spdx}`);
  L();
  L("".padEnd(78, "-"));
  L("Apache License 2.0 — canonical text");
  L("".padEnd(78, "-"));
  L();
  L(apacheLicenseText.trim());
  L();
}

writeFileSync(path.join(worktree, "resources/THIRD-PARTY-LICENSES.txt"), lic.join("\n") + "\n", "utf8");

/* --------------------- THIRD-PARTY-NOTICES.md ---------------------------- */

const lines: string[] = [];
const w = (s = ""): void => void lines.push(s);

w("# Third-party notices");
w();
w("FixLang is licensed under GPL-3.0-or-later. Its licence text is in `LICENSE.md`,");
w("which ships alongside this file inside the application bundle.");
w();
w("FixLang bundles the third-party material listed below, each of which remains");
w("under its own licence. **Verbatim licence texts for every bundled npm package");
w("are in `THIRD-PARTY-LICENSES.txt`, in this same directory.**");
w();
w("Both files ship inside the application bundle so notices travel with the");
w("binaries, as MIT and Apache-2.0 both require.");
w();
w("Regenerate both when themes or runtime dependencies change.");
w();
w("---");
w();
w("## Editor themes — from `shikijs/textmate-grammars-themes`");
w();
w(`${String(shikiThemes.length)} colour schemes are taken from the \`tm-themes\` package of`);
w("[shikijs/textmate-grammars-themes](https://github.com/shikijs/textmate-grammars-themes)");
w("(packaging MIT © Pine Wu & Anthony Fu). Each theme originates from a separate");
w("project and keeps that project's licence, as recorded in the upstream");
w("[NOTICE](https://github.com/shikijs/textmate-grammars-themes/blob/main/packages/tm-themes/NOTICE).");
w();
w(`Licence spread: ${tally(shikiThemes.map((t) => t.spdx))}.`);
w();
w("Note: `aurora-x.json` is licensed **GPL-3.0**. FixLang is distributed under");
w("GPL-3.0-or-later, which is compatible; this file may not be redistributed under");
w("a permissive licence.");
w();
w("| Theme file | Licence | Copyright | Licence text |");
w("| ---------- | ------- | --------- | ------------ |");
for (const t of shikiThemes) {
  w(`| \`${t.file}\` | ${t.spdx} | ${t.copyright || "—"} | [licence](${t.license}) |`);
}
w();
w("---");
w();
w("## Terminal themes — from terminalcolors.com");
w();
w(`${String(terminalThemes.length)} palettes (theme ids prefixed \`tc-\`) were derived from the`);
w("Alacritty colour-scheme downloads published on");
w("[terminalcolors.com](https://terminalcolors.com), converted to FixLang's theme");
w("format by `scripts/download-terminalcolors.ts`.");
w();
w("**The licence of this material is unstated.** That site carries only a");
w("`© 2025 terminalcolors.com` footer, with no licence, terms, credits, or links to");
w("the upstream projects the palettes came from. FixLang therefore cannot attribute");
w("these palettes to their original authors, and cannot state terms for them.");
w();
w("Many of these palettes are well-known community colour schemes that are");
w("permissively licensed at their true source. If you are the author of one of these");
w("palettes, or you can identify its origin, please open an issue — correct");
w("attribution or removal will be actioned. If you hold rights in this material and");
w("want it removed, it will be removed on request.");
w();
w("<details><summary>Affected theme files</summary>");
w();
for (const f of terminalThemes) w(`- \`terminal/${f}\``);
w();
w("</details>");
w();
w("---");
w();
w("## Trademarks");
w();
w("Some theme names identify the product whose visual style the palette resembles:");
w();
for (const f of brandThemes) w(`- \`brands/${f}\``);
w();
w("plus upstream-named themes such as `slack-dark`, `slack-ochin`, `github-*`,");
w("`dark-plus`, and `light-plus`.");
w();
w("Claude Code and Claude are trademarks of Anthropic. Codex and ChatGPT are");
w("trademarks of OpenAI. Cursor is a trademark of Anysphere. Shopify is a trademark");
w("of Shopify Inc. Slack is a trademark of Slack Technologies. GitHub is a trademark");
w("of GitHub, Inc. Visual Studio Code is a trademark of Microsoft. Amazon Bedrock");
w("and AWS are trademarks of Amazon.com, Inc. All other product names, logos, and");
w("brands are the property of their respective owners.");
w();
w("These names are used only to describe the visual appearance of a colour scheme.");
w("FixLang is not affiliated with, endorsed by, or sponsored by any of these");
w("companies, and no such affiliation is implied.");
w();
w("---");
w();
w("## Bundled npm packages");
w();
w("FixLang ships no `node_modules` directory — Vite compiles these packages into the");
w("application, so their notices are included here and their full licence texts in");
w("`THIRD-PARTY-LICENSES.txt`.");
w();
w(`This is the complete runtime dependency closure: **${String(packages.length)} packages**, resolved`);
w("transitively from `dependencies` the way Node would resolve them, not just the");
w("top-level entries. Vite tree-shakes some of these out of the final bundle, so the");
w("list over-includes rather than under-includes — crediting a package that was");
w("dropped is harmless, omitting one that shipped is not.");
w();
w(`Licence spread: ${tally(packages.map((p) => p.spdx))}.`);
w();
w("| Package | Version | Licence | Project |");
w("| ------- | ------- | ------- | ------- |");
for (const p of packages) {
  w(`| \`${p.name}\` | ${p.version} | ${p.spdx} | ${p.url ? `[source](${p.url})` : "—"} |`);
}
w();
w("Electron itself bundles Chromium and Node.js; see");
w("<https://github.com/electron/electron/blob/main/LICENSE> and the");
w("`LICENSES.chromium.html` file inside the Electron distribution.");
w();
w("---");
w();
w("## Icons and fonts");
w();
w("Application icons under `resources/` are original to FixLang. FixLang uses the");
w("system font stack and bundles no third-party font files.");
w();

writeFileSync(path.join(worktree, "resources/THIRD-PARTY-NOTICES.md"), lines.join("\n"), "utf8");

console.log(
  [
    `themes: shiki=${String(shikiThemes.length)} terminal=${String(terminalThemes.length)} brands=${String(brandThemes.length)}`,
    `packages=${String(packages.length)}`,
    `unique licence texts=${String(orderedGroups.length)}`,
    `packages with no licence file=${String(withoutText.length)}`,
  ].join(" | "),
);
