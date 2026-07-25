/**
 * @file i18n-check.ts
 * @description Bun-runnable guardrail CLI for the i18n catalogs. Runs every
 * invariant in `src/shared/i18n/catalogIntegrity.ts` against the real
 * `src/shared/i18n/locales/{en,ja}/*.json` files, prints a per-namespace
 * summary plus the JA translation-coverage percentage, and exits non-zero if
 * any violation is found.
 *
 * Usage: bun run i18n:check
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type IntegrityViolation,
  type NamespaceRaw,
  checkCatalogIntegrity,
  parseCatalog,
} from "../src/shared/i18n/catalogIntegrity";
import { CATALOG_NAMESPACES } from "../src/shared/i18n/locales";
import { LOCALE_CODES } from "../src/shared/i18n/registry";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(scriptsDir, "..", "src/shared/i18n/locales");

const [sourceLocale, ...otherLocales] = LOCALE_CODES;

const loadNamespaces = (): NamespaceRaw[] =>
  CATALOG_NAMESPACES.map((namespace) => {
    const rawByLocale: NamespaceRaw["rawByLocale"] = {};
    for (const locale of LOCALE_CODES) {
      rawByLocale[locale] = readFileSync(
        path.join(localesDir, locale, `${namespace}.json`),
        "utf8",
      );
    }
    return { namespace, rawByLocale };
  });

const countKeys = (namespaces: readonly NamespaceRaw[], locale: string): number =>
  namespaces.reduce((sum, { rawByLocale }) => {
    const raw = rawByLocale[locale as (typeof LOCALE_CODES)[number]];
    return sum + (raw === undefined ? 0 : Object.keys(parseCatalog(raw)).length);
  }, 0);

const groupByNamespace = (
  violations: readonly IntegrityViolation[],
): Map<string, IntegrityViolation[]> => {
  const grouped = new Map<string, IntegrityViolation[]>();
  for (const violation of violations) {
    const key = violation.namespace ?? "(global)";
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(violation);
    } else {
      grouped.set(key, [violation]);
    }
  }
  return grouped;
};

const printSummary = (
  namespaces: readonly NamespaceRaw[],
  violations: readonly IntegrityViolation[],
): void => {
  const grouped = groupByNamespace(violations);

  console.log("i18n catalog integrity check");
  console.log("=============================");
  for (const { namespace } of namespaces) {
    const namespaceViolations = grouped.get(namespace) ?? [];
    const status = namespaceViolations.length === 0 ? "OK" : `${String(namespaceViolations.length)} violation(s)`;
    console.log(`  ${namespace.padEnd(16)} ${status}`);
    for (const violation of namespaceViolations) {
      console.log(
        `    - [${violation.rule}]${violation.locale ? ` (${violation.locale})` : ""} ${violation.message}`,
      );
    }
  }

  const globalViolations = grouped.get("(global)") ?? [];
  if (globalViolations.length > 0) {
    console.log(`  ${"(global)".padEnd(16)} ${String(globalViolations.length)} violation(s)`);
    for (const violation of globalViolations) {
      console.log(`    - [${violation.rule}] ${violation.message}`);
    }
  }

  const enTotal = countKeys(namespaces, sourceLocale);
  console.log("");
  for (const locale of otherLocales) {
    const localeTotal = countKeys(namespaces, locale);
    const coverage = enTotal === 0 ? 0 : (localeTotal / enTotal) * 100;
    console.log(
      `${locale.toUpperCase()} translation coverage: ${coverage.toFixed(1)}% (${String(localeTotal)}/${String(enTotal)} keys)`,
    );
  }

  console.log("");
  console.log(
    violations.length === 0
      ? "All catalog integrity invariants passed."
      : `${String(violations.length)} total violation(s) found.`,
  );
};

const main = (): void => {
  const namespaces = loadNamespaces();
  const violations = checkCatalogIntegrity(namespaces, LOCALE_CODES, sourceLocale);

  printSummary(namespaces, violations);

  if (violations.length > 0) {
    process.exit(1);
  }
};

main();
