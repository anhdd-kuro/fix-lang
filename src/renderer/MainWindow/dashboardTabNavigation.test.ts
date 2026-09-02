/**
 * @file dashboardTabNavigation.test.ts
 * @description Regression test for the PR #114 review finding: the tray's
 * credit-balance card called `showMainWindowTab("openrouter")` after that tab
 * was renamed to `usage`. Preload kept its OWN hand-copied `DashboardTabId`
 * union, so the stale id still typechecked; `App.tsx` resolves the id through
 * `DASHBOARD_TABS.findIndex`, which returned -1, and the button silently did
 * nothing — no error, no navigation, nothing to catch but a click.
 *
 * The union now lives once in `~/features/core/shared/dashboardTabIds`, which makes the type
 * half compile-time impossible. This covers the other half: that every id
 * actually PASSED to `showMainWindowTab` names a tab that exists. A literal is
 * type-correct and still wrong the moment a tab is renamed and one call site is
 * missed.
 *
 * Scans source text rather than importing the callers, because the assertion is
 * about what the shipped call sites say — and because rendering them would need
 * a DOM testing library the repo does not install.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_TABS } from "./dashboardTabs";

const RENDERER_ROOT = join(import.meta.dirname, "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });

/** Every string literal handed to `showMainWindowTab`, with its file. */
const navigationTargets = (): { file: string; tabId: string }[] =>
  sourceFiles(RENDERER_ROOT).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/showMainWindowTab\(\s*"([^"]+)"/g)].map(
      (match) => ({ file: file.slice(RENDERER_ROOT.length + 1), tabId: match[1] }),
    );
  });

describe("dashboard tab navigation targets", () => {
  const knownTabIds = new Set(DASHBOARD_TABS.map((tab) => tab.id));

  it("scans the renderer and finds the tray's call site", () => {
    const targets = navigationTargets();

    // Guards the scanner itself: a regex that silently matches nothing would
    // make every assertion below vacuously true.
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.map((target) => target.file)).toContain(
      "TrayWindow/components/TrayProviderSummary.tsx",
    );
  });

  it("only ever navigates to a tab that exists", () => {
    const unknown = navigationTargets().filter(
      (target) => !knownTabIds.has(target.tabId as (typeof DASHBOARD_TABS)[number]["id"]),
    );

    expect(unknown).toEqual([]);
  });
});
