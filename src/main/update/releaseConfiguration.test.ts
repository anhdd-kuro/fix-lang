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

describe("unsigned GitHub Releases distribution", () => {
  it("builds an explicitly unsigned arm64 DMG without an updater runtime", () => {
    const packageJson = readPackageJson();
    const build = buildConfiguration(packageJson);

    expect(packageJson.version).toMatch(
      /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
    );
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
    expect(draftStep).toContain("refusing to replace its assets");
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
});
