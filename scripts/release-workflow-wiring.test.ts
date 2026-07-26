/**
 * @file release-workflow-wiring.test.ts
 * @description Nothing else verifies that `.github/workflows/release.yml`
 * actually runs `bun run check:bundle` in the `release` job, or that it runs
 * it in the right place: after the build that produces `out/` (the guard
 * scans `out/`, so running it before a build would silently pass on stale or
 * absent output) and before `electron-builder` packages the DMG (so a real
 * violation blocks packaging instead of shipping it). This test would have
 * caught the step being deleted, renamed away from `check:bundle`, or moved
 * to the wrong side of either neighbor.
 *
 * This is a plain substring/ordering check on the workflow text rather than a
 * full YAML parse: the repo has no YAML-parsing package declared as a direct
 * dependency (only transitive ones), and a full parse buys nothing extra here
 * over locating three known, stable command substrings in file order.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = path.join(
  import.meta.dirname,
  "../.github/workflows/release.yml",
);

function readReleaseJobStepsText(): string {
  const workflow = readFileSync(workflowPath, "utf8");

  // Top-level job keys are two-space indented (e.g. "  prepare:", "  release:").
  // "release:" is currently the last job, but match up to the next top-level
  // key (or EOF) rather than assuming that, so this stays correct if another
  // job is appended after it.
  const releaseJobMatch = /\n {2}release:\n([\s\S]*?)(?=\n {2}\S|$)/.exec(
    workflow,
  );
  if (releaseJobMatch === null) {
    throw new Error(
      "Could not locate the 'release:' job in .github/workflows/release.yml — " +
        "has the workflow been restructured?",
    );
  }

  return releaseJobMatch[1];
}

describe("release.yml release job wiring", () => {
  it("runs check:bundle after the build and before packaging the DMG", () => {
    const releaseJob = readReleaseJobStepsText();

    const buildIndex = releaseJob.indexOf("run: bun run build");
    const checkBundleIndex = releaseJob.indexOf("run: bun run check:bundle");
    const packageDmgIndex = releaseJob.indexOf(
      "electron-builder --mac --arm64 --publish never",
    );

    expect(
      buildIndex,
      "expected a step running `bun run build` in the release job",
    ).toBeGreaterThan(-1);
    expect(
      checkBundleIndex,
      "expected a step running `bun run check:bundle` in the release job " +
        "(the bundle-externals guard) — see .claude/skills/fixlang/fixlang-bundle-externals/SKILL.md",
    ).toBeGreaterThan(-1);
    expect(
      packageDmgIndex,
      "expected a step invoking electron-builder to build the arm64 DMG",
    ).toBeGreaterThan(-1);

    expect(checkBundleIndex).toBeGreaterThan(buildIndex);
    expect(packageDmgIndex).toBeGreaterThan(checkBundleIndex);
  });
});
