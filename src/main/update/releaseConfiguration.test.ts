import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const readProjectFile = (relativePath: string): string =>
  readFileSync(path.join(projectRoot, relativePath), "utf8");

const readPackageJson = (): Record<string, unknown> =>
  JSON.parse(readProjectFile("package.json")) as Record<string, unknown>;

const buildConfiguration = (packageJson: Record<string, unknown>) =>
  packageJson.build as Record<string, unknown>;

const workflowStep = (workflow: string, stepName: string): string => {
  const marker = `      - name: ${stepName}`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`Missing workflow step: ${stepName}`);

  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
};

const workflowStepSecrets = (workflow: string, stepName: string): string[] =>
  Array.from(
    workflowStep(workflow, stepName).matchAll(
      /\$\{\{\s*secrets\.([A-Z0-9_]+)\s*}}/g,
    ),
    (match) => match[1],
  );

const workflowJob = (workflow: string, jobId: string): string => {
  const marker = `\n  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`Missing workflow job: ${jobId}`);

  const body = workflow.slice(start + marker.length);
  const next = body.search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next === -1 ? body : body.slice(0, next);
};

const shellLines = (step: string): string[] =>
  step
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

// What a step actually executes. Matching against the raw text would accept a
// commented-out copy of a line as proof the line still runs.
const executedShell = (step: string): string => shellLines(step).join("\n");

// A version this repository may publish from *some* branch: stable on main, or
// X.Y.Z-beta.N on a beta/* branch. Stable-only on main is not this file's job —
// release.yml's stable_version_pattern refuses a prerelease version before it
// creates any tag, and that guard is pinned below.
const RELEASE_VERSION =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-beta\.(0|[1-9][0-9]*))?$/;

describe("unsigned GitHub Releases distribution", () => {
  it("builds an explicitly unsigned arm64 DMG without an updater runtime", () => {
    const packageJson = readPackageJson();
    const build = buildConfiguration(packageJson);

    // Stable OR X.Y.Z-beta.N. prerelease.yml runs `bun run test` as a publish gate
    // from a beta/* branch, and it creates the tag first: a strict-stable assertion
    // here fails that gate on every beta, leaving a dangling tag whose deletion is
    // manual. The invariant "main never carries a prerelease version" survives in
    // release.yml's stable_version_pattern, which refuses before any tag is cut.
    expect(packageJson.version).toMatch(RELEASE_VERSION);
    expect(packageJson.dependencies).not.toHaveProperty("electron-updater");
    // Prevent repository-based publish inference from embedding app-update.yml.
    expect(build.publish).toBeNull();
    expect(build).not.toHaveProperty("electronUpdaterCompatibility");
    expect(build.mac).toEqual(
      expect.objectContaining({
        target: ["dmg"],
        identity: null,
        notarize: false,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        artifactName: "${productName}-${version}-${arch}.${ext}",
      }),
    );
    expect(build.mac).not.toHaveProperty("entitlements");
    expect(build.mac).not.toHaveProperty("entitlementsInherit");
    expect(build.dmg).toEqual(
      expect.objectContaining({ writeUpdateInfo: false }),
    );

    const viteConfig = readProjectFile("electron.vite.config.ts");
    expect(viteConfig).toContain('external: ["electron"]');
    expect(viteConfig).not.toContain("electron-updater");
  });

  it("publishes only a validated unsigned DMG and checksum after monotonic version resolution", () => {
    const workflowPath = ".github/workflows/release.yml";
    const fullPath = path.join(projectRoot, workflowPath);
    expect(existsSync(fullPath), `${workflowPath} must exist`).toBe(true);

    const workflow = readFileSync(fullPath, "utf8");
    expect(workflow).toMatch(/branches:\s*\[\s*['"]main['"]\s*\]/);
    expect(workflow).toMatch(/tags:\s*\[\s*['"]v\*\.\*\.\*['"]\s*\]/);
    expect(workflow).toContain("group: fixlang-release");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("Resolve release version and tag");
    expect(workflow).toContain("refs/remotes/origin/main");
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain("repos/${GITHUB_REPOSITORY}/git/refs");
    expect(workflow).toContain("should_publish=true");
    expect(workflow).toContain("should_publish=false");
    expect(workflow).toContain("already has a public release; skipping publication");
    expect(workflow).toContain("has no completed release; resuming publication");
    expect(workflow).toContain("latest public stable release");
    expect(workflow).toContain("must be greater than");
    expect(workflow).toContain(
      "stable_version_pattern='^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'",
    );
    expect(workflow).toContain(
      'if ! [[ "${package_version}" =~ ${stable_version_pattern} ]]; then',
    );
    expect(workflow).toContain(
      "/^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$/.exec(tag)",
    );
    expect(workflow).toContain("components.every(Number.isSafeInteger)");
    expect(workflow).toContain("parts.every(Number.isSafeInteger)");
    expect(workflow).toContain("parts: parts.map(BigInt)");
    expect(workflow).toContain(
      "return left.parts[index] < right.parts[index] ? -1 : 1;",
    );
    expect(workflow).toContain("gh api --paginate --slurp");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run test");
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"');
    expect(workflow).toContain("electron-builder --mac --arm64 --publish never");
    expect(workflow).toContain("hdiutil verify");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toContain("shasum -a 256");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("--draft=false");
    // The stable feed is what every user's update check and the Homebrew tap read.
    // A --prerelease anywhere in this workflow would take genuine releases off it.
    expect(workflow).not.toContain("--prerelease");
    expect(workflow).not.toContain("--clobber");
    expect(workflow).not.toContain("MAC_CSC_");
    expect(workflow).not.toContain("APPLE_API_");
    expect(workflow).not.toContain("codesign");
    expect(workflow).not.toContain("spctl");
    expect(workflow).not.toContain("xcrun stapler");

    const validateStep = workflowStep(workflow, "Validate unsigned arm64 artifacts");
    const draftStep = workflowStep(workflow, "Create or resume draft release");
    expect(validateStep).toContain('test -s "release/FixLang-${package_version}-arm64.dmg"');
    expect(validateStep).toContain('hdiutil verify "release/FixLang-${package_version}-arm64.dmg"');
    expect(validateStep).toContain('CFBundleShortVersionString');
    // app.asar ships no node_modules and must ship out/renderer; without these the
    // stable DMG can be a MODULE_NOT_FOUND or white-screen app. Pinned here as well
    // as in the prerelease workflow so neither copy can lose the guard alone.
    expect(executedShell(validateStep)).toContain("bunx @electron/asar list");
    expect(executedShell(validateStep)).toContain("/node_modules/");
    expect(executedShell(validateStep)).toContain("^/out/renderer/");
    expect(draftStep).toContain("refusing to replace its assets");

    const publishStep = workflowStep(workflow, "Publish completed release");
    expect(publishStep).toContain("gh release edit");
    expect(publishStep).toContain("--draft=false");
    expect(publishStep).toContain("--latest");
    expect(publishStep).not.toContain("--prerelease");
    expect(workflow.indexOf("Validate unsigned arm64 artifacts")).toBeLessThan(
      workflow.indexOf("Create or resume draft release"),
    );
    expect(
      workflow.indexOf(
        'if ! [[ "${package_version}" =~ ${stable_version_pattern} ]]; then',
      ),
    ).toBeLessThan(
      workflow.indexOf('gh api --method POST "repos/${GITHUB_REPOSITORY}/git/refs"'),
    );
    expect(
      workflow.indexOf("components.every(Number.isSafeInteger)"),
    ).toBeLessThan(
      workflow.indexOf('gh api --method POST "repos/${GITHUB_REPOSITORY}/git/refs"'),
    );
    expect(workflowStep(workflow, "Upload validated release assets")).toContain(
      '"release/FixLang-${package_version}-arm64.dmg"',
    );
    expect(workflowStep(workflow, "Verify uploaded release assets")).toContain(
      "SHA256SUMS.txt",
    );
    expect(workflowStep(workflow, "Verify uploaded release assets")).toContain(
      "gh release download",
    );
    expect(workflowStep(workflow, "Verify uploaded release assets")).toContain(
      "shasum -a 256 -c SHA256SUMS.txt",
    );
    expect(workflowStep(workflow, "Verify uploaded release assets")).toContain(
      "remote_asset_count",
    );

    expect(workflowStepSecrets(workflow, "Check out release history")).toEqual([]);
    expect(workflowStepSecrets(workflow, "Resolve release version and tag")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Create or resume draft release")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Upload validated release assets")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Verify uploaded release assets")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Publish completed release")).toEqual([
      "GITHUB_TOKEN",
    ]);
  });

  it("keeps package and public-release versions to strict stable semver", () => {
    const stableVersion =
      /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
    const stableTag =
      /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
    const hasSafeComponents = (value: string, pattern: RegExp): boolean => {
      const match = pattern.exec(value);
      return (
        match !== null &&
        match.slice(1).every((component) =>
          Number.isSafeInteger(Number(component)),
        )
      );
    };

    expect(stableVersion.test("0.2.0")).toBe(true);
    expect(stableVersion.test("01.2.3")).toBe(false);
    expect(stableVersion.test("1.02.3")).toBe(false);
    expect(stableVersion.test("1.2.03")).toBe(false);
    expect(stableVersion.test("1.2.3-beta.1")).toBe(false);
    expect(hasSafeComponents("1.2.3", stableVersion)).toBe(true);
    expect(hasSafeComponents("9007199254740992.0.0", stableVersion)).toBe(
      false,
    );
    expect(stableTag.test("v1.2.3")).toBe(true);
    expect(stableTag.test("v01.2.3")).toBe(false);
    expect(hasSafeComponents("v9007199254740992.0.0", stableTag)).toBe(false);
  });

  it("allows Actions to create release tags while preventing tag replacement", () => {
    const ruleset = JSON.parse(
      readProjectFile(".github/release-tag-ruleset.json"),
    ) as {
      bypass_actors: { actor_type: string }[];
      rules: { type: string }[];
    };

    expect(ruleset.bypass_actors).toEqual([
      expect.objectContaining({ actor_type: "User" }),
    ]);
    expect(ruleset.rules.map((rule) => rule.type)).toEqual([
      "update",
      "deletion",
    ]);
  });

  it("excludes beta tags from update/deletion protection while keeping stable tags protected", () => {
    const ruleset = JSON.parse(
      readProjectFile(".github/release-tag-ruleset.json"),
    ) as {
      conditions: { ref_name: { exclude: string[]; include: string[] } };
      rules: { type: string }[];
    };

    expect(ruleset.conditions.ref_name.include).toEqual(["refs/tags/v*"]);
    expect(ruleset.conditions.ref_name.exclude).toEqual([
      "refs/tags/v*-beta.*",
    ]);
    // Re-assert (not re-relax) the stable protection this exclusion sits next to.
    expect(ruleset.rules.map((rule) => rule.type)).toEqual([
      "update",
      "deletion",
    ]);
  });

  it("publishes beta builds as GitHub prereleases under the same gates as stable, without touching the stable workflow", () => {
    const workflowPath = ".github/workflows/prerelease.yml";
    const fullPath = path.join(projectRoot, workflowPath);
    expect(existsSync(fullPath), `${workflowPath} must exist`).toBe(true);

    const workflow = readFileSync(fullPath, "utf8");
    expect(workflow).toMatch(/branches:\s*\[\s*['"]beta\/\*\*['"]\s*\]/);
    expect(workflow).toContain("contents: write");
    // Tag creation, draft creation and two immutable asset uploads are one
    // non-atomic remote sequence. Cancelling between any two of them wedges the
    // channel until a human deletes the tag or the draft, so a second push must
    // queue behind the first, exactly as the stable workflow does.
    expect(workflow).toContain("group: fixlang-prerelease-");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("cancel-in-progress: true");
    // The review anchor, and it has to sit on the job that publishes: an
    // `environment` on prepare gates nothing. Stable is bounded by "only publishes
    // from main"; a beta branch has no such bound, so publication hangs on an
    // Environment whose required-reviewers rule is configured in repository settings.
    const prepareJob = workflowJob(workflow, "prepare");
    const releaseJob = workflowJob(workflow, "release");
    expect(releaseJob).toMatch(/^\s{4}environment: prerelease$/m);
    expect(workflow).toContain("Resolve prerelease version and tag");
    expect(workflow).toContain(
      "beta_version_pattern='^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)-beta\\.(0|[1-9][0-9]*)$'",
    );
    expect(workflow).toContain(
      'if ! [[ "${package_version}" =~ ${beta_version_pattern} ]]; then',
    );
    expect(workflow).toContain(
      "package.json version must be a pre-release semantic version",
    );
    expect(workflow).toContain("should_publish=true");
    expect(workflow).toContain("should_publish=false");
    expect(workflow).toContain("repos/${GITHUB_REPOSITORY}/git/refs");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run test");
    expect(workflow).toContain("bun run i18n:check");
    expect(workflow).toContain("bun run build");
    expect(workflow).toContain("bun run check:bundle");
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"');
    expect(workflow).toContain("electron-builder --mac --arm64 --publish never");
    expect(workflow).toContain("hdiutil verify");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toContain("shasum -a 256");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("--draft=false");
    expect(workflow).not.toContain("--latest");
    expect(workflow).not.toContain("--clobber");
    expect(workflow).not.toContain("MAC_CSC_");
    expect(workflow).not.toContain("APPLE_API_");
    expect(workflow).not.toContain("codesign");
    expect(workflow).not.toContain("spctl");
    expect(workflow).not.toContain("xcrun stapler");

    const validateStep = workflowStep(workflow, "Validate unsigned arm64 artifacts");
    const draftStep = workflowStep(workflow, "Create or resume draft prerelease");
    expect(validateStep).toContain('test -s "release/FixLang-${package_version}-arm64.dmg"');
    expect(validateStep).toContain('hdiutil verify "release/FixLang-${package_version}-arm64.dmg"');
    expect(validateStep).toContain("CFBundleShortVersionString");
    expect(executedShell(validateStep)).toContain("/node_modules/");
    expect(executedShell(validateStep)).toContain("^/out/renderer/");
    // R6 discovery signal: if electron-builder ever mangles "-beta.N" in the DMG
    // basename, this step is where it surfaces, and a bare `test -s` reports only
    // an exit code.
    expect(validateStep).toContain("ls -la release/");
    expect(executedShell(draftStep)).toContain("--prerelease");
    expect(draftStep).toContain("refusing to replace its assets");
    expect(workflow.indexOf("Validate unsigned arm64 artifacts")).toBeLessThan(
      workflow.indexOf("Create or resume draft prerelease"),
    );

    // Drift guard. Roughly 185 lines here are a verbatim copy of release.yml, and a
    // beta tester runs the least-tested build with the hardest recovery path, so the
    // beta artifact may never be validated more weakly than the stable one: every
    // line the stable validation runs must also run here. Extra lines (diagnostics)
    // are allowed; dropped ones are not.
    const stableWorkflow = readProjectFile(".github/workflows/release.yml");
    const stableValidateStep = workflowStep(
      stableWorkflow,
      "Validate unsigned arm64 artifacts",
    );
    const executedValidation = executedShell(validateStep);
    for (const line of shellLines(stableValidateStep)) {
      expect(
        executedValidation,
        `prerelease.yml validation is missing a line release.yml runs: ${line}`,
      ).toContain(line);
    }

    // Gates run before anything is built, packaged or published, and they run in the
    // job that publishes. Presence alone is satisfied by a job that packages first
    // and lints afterwards, or by gates parked in a job nothing waits on.
    const positionOf = (needle: string): number => {
      const index = releaseJob.indexOf(needle);
      expect(
        index,
        `prerelease.yml release job is missing: ${needle}`,
      ).toBeGreaterThan(-1);
      return index;
    };
    const buildIndex = positionOf("run: bun run build");
    const packageIndex = positionOf(
      "electron-builder --mac --arm64 --publish never",
    );
    expect(positionOf("run: bun run lint")).toBeLessThan(buildIndex);
    expect(positionOf("run: bun run test")).toBeLessThan(buildIndex);
    expect(positionOf("run: bun run i18n:check")).toBeLessThan(buildIndex);
    // check:bundle scans the built output, so it comes after build and before the
    // DMG that would otherwise ship the unresolvable dependency.
    expect(buildIndex).toBeLessThan(positionOf("run: bun run check:bundle"));
    expect(positionOf("run: bun run check:bundle")).toBeLessThan(packageIndex);
    expect(packageIndex).toBeLessThan(
      positionOf("- name: Validate unsigned arm64 artifacts"),
    );
    expect(positionOf("- name: Create or resume draft prerelease")).toBeLessThan(
      positionOf("- name: Publish completed prerelease"),
    );

    // The call that actually makes the release public. --prerelease appearing
    // anywhere in the file is satisfied by the draft step alone; dropping it here
    // publishes a beta as an ordinary release, which the Homebrew tap then syncs
    // into the stable cask.
    const publishStep = executedShell(
      workflowStep(workflow, "Publish completed prerelease"),
    );
    expect(publishStep).toContain("gh release edit");
    expect(publishStep).toContain("--draft=false");
    expect(publishStep).toContain("--prerelease");
    expect(workflow).toContain(
      "docs/superpowers/specs/2026-07-22-homebrew-distribution-design.md",
    );
    expect(
      existsSync(
        path.join(
          projectRoot,
          "docs/superpowers/specs/2026-07-22-homebrew-distribution-design.md",
        ),
      ),
    ).toBe(true);

    // Beta tags are excluded from the ruleset's update protection, so the tag can be
    // retargeted between jobs and after publication. The build input is the commit
    // prepare resolved, and the release body records it.
    const checkoutStep = workflowStep(workflow, "Check out the release commit");
    // The output has to come from prepare: `needs.prepare.outputs.release_sha`
    // resolves to the empty string if it is declared anywhere else, and checkout
    // with an empty ref silently falls back to the branch head.
    expect(prepareJob).toContain("release_sha: ${{ github.sha }}");
    expect(checkoutStep).toContain("ref: ${{ needs.prepare.outputs.release_sha }}");
    expect(checkoutStep).not.toContain("needs.prepare.outputs.release_tag");
    expect(executedShell(draftStep)).toContain("--generate-notes");
    expect(executedShell(draftStep)).toContain(
      '--notes "Built from commit ${RELEASE_SHA}."',
    );

    expect(workflowStepSecrets(workflow, "Check out branch history")).toEqual([]);
    expect(workflowStepSecrets(workflow, "Resolve prerelease version and tag")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Create or resume draft prerelease")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Upload validated release assets")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Verify uploaded release assets")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStepSecrets(workflow, "Publish completed prerelease")).toEqual([
      "GITHUB_TOKEN",
    ]);
  });

  it("keeps the stable-only guard rejecting beta-shaped versions in release.yml", () => {
    const stableWorkflow = readProjectFile(".github/workflows/release.yml");
    const stableVersionPattern = /stable_version_pattern='([^']+)'/.exec(
      stableWorkflow,
    );
    expect(stableVersionPattern).not.toBeNull();

    const pattern = new RegExp(stableVersionPattern?.[1] ?? "");
    expect(pattern.test("1.2.3-beta.1")).toBe(false);
    expect(pattern.test("1.2.3")).toBe(true);
  });

  it("accepts and rejects the expected beta version shapes", () => {
    const betaVersion =
      /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-beta\.(0|[1-9][0-9]*)$/;
    const betaTag =
      /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-beta\.(0|[1-9][0-9]*)$/;

    expect(betaVersion.test("0.32.0-beta.1")).toBe(true);
    expect(betaVersion.test("0.32.0-beta.0")).toBe(true);
    expect(betaVersion.test("0.32.0")).toBe(false);
    expect(betaVersion.test("0.32.0-beta.01")).toBe(false);
    expect(betaVersion.test("0.32.0-alpha.1")).toBe(false);
    expect(betaTag.test("v0.32.0-beta.1")).toBe(true);
    expect(betaTag.test("0.32.0-beta.1")).toBe(false);

    // The version shape package.json is allowed to carry, on any branch. Widening it
    // to accept betas must not widen it to accept anything else.
    expect(RELEASE_VERSION.test("0.32.0")).toBe(true);
    expect(RELEASE_VERSION.test("0.32.0-beta.1")).toBe(true);
    expect(RELEASE_VERSION.test("0.32.0-beta.0")).toBe(true);
    expect(RELEASE_VERSION.test("0.32.0-beta")).toBe(false);
    expect(RELEASE_VERSION.test("0.32.0-beta.01")).toBe(false);
    expect(RELEASE_VERSION.test("0.32.0-beta.1.2")).toBe(false);
    expect(RELEASE_VERSION.test("0.32.0-alpha.1")).toBe(false);
    expect(RELEASE_VERSION.test("0.32.0-rc.1")).toBe(false);
    expect(RELEASE_VERSION.test("01.32.0")).toBe(false);
    expect(RELEASE_VERSION.test("v0.32.0")).toBe(false);
  });
});
