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

describe("public GitHub Releases update distribution", () => {
  it("declares a stable public update feed in the application package", () => {
    const packageJson = readPackageJson();
    const build = buildConfiguration(packageJson);

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "https://github.com/anhdd-kuro/fix-lang.git",
    });
    expect(packageJson.dependencies).toMatchObject({
      "electron-updater": "6.8.9",
    });
    expect(build.electronUpdaterCompatibility).toBe(">= 2.16");
    expect(build.publish).toEqual([
      {
        provider: "github",
        owner: "anhdd-kuro",
        repo: "fix-lang",
        tagNamePrefix: "v",
        releaseType: "draft",
      },
    ]);
    expect(build.mac).toMatchObject({
      target: expect.arrayContaining(["dmg", "zip"]),
      hardenedRuntime: true,
      entitlements: "resources/entitlements.mac.plist",
      entitlementsInherit: "resources/entitlements.mac.inherit.plist",
    });
  });

  it("keeps the required macOS entitlement files with Electron JIT support", () => {
    for (const entitlementsPath of [
      "resources/entitlements.mac.plist",
      "resources/entitlements.mac.inherit.plist",
    ]) {
      const fullPath = path.join(projectRoot, entitlementsPath);
      expect(existsSync(fullPath), `${entitlementsPath} must exist`).toBe(true);

      const entitlements = readFileSync(fullPath, "utf8");
      expect(entitlements).toContain(
        "com.apple.security.cs.allow-jit",
      );
      expect(entitlements).toContain(
        "com.apple.security.cs.allow-unsigned-executable-memory",
      );
    }
  });

  it("publishes a new package version from main and keeps manual tags as a recovery path", () => {
    const workflowPath = ".github/workflows/release.yml";
    const fullPath = path.join(projectRoot, workflowPath);
    expect(existsSync(fullPath), `${workflowPath} must exist`).toBe(true);

    const workflow = readFileSync(fullPath, "utf8");
    expect(workflow).toMatch(/branches:\s*\[\s*['"]main['"]\s*\]/);
    expect(workflow).toMatch(/tags:\s*\[\s*['"]v\*\.\*\.\*['"]\s*\]/);
    expect(workflow).toContain("group: fixlang-release");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain(
      "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    );
    expect(workflowStep(workflow, "Check out release history")).toContain(
      "persist-credentials: false",
    );
    expect(workflowStep(workflow, "Check out release history")).toContain(
      "fetch-depth: 0",
    );
    expect(workflowStep(workflow, "Check out release history")).not.toContain(
      "token:",
    );
    expect(workflow).toContain(
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2",
    );
    const jobPreamble = workflow.slice(
      workflow.indexOf("jobs:"),
      workflow.indexOf("    steps:"),
    );
    expect(jobPreamble).not.toContain("${{ secrets.");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run test");
    expect(workflow).toContain("Resolve release version and tag");
    expect(workflow).toContain("package.json");
    expect(workflow).toContain("GITHUB_REF_NAME");
    expect(workflow).toContain('refs/remotes/origin/main');
    expect(workflow).toContain('^[0-9]+\\.[0-9]+\\.[0-9]+$');
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain("repos/${GITHUB_REPOSITORY}/git/refs");
    expect(workflow).toContain("should_publish=true");
    expect(workflow).toContain("should_publish=false");
    expect(workflow).toContain(
      "needs.prepare.outputs.should_publish == 'true'",
    );
    expect(workflow).toContain(
      "RELEASE_TAG: ${{ needs.prepare.outputs.release_tag }}",
    );
    expect(workflowStep(workflow, "Resolve release version and tag")).toContain(
      'gh release view "${release_tag}" --json isDraft',
    );
    expect(workflowStep(workflow, "Resolve release version and tag")).toContain(
      "already has a public release; skipping publication",
    );
    expect(workflowStep(workflow, "Resolve release version and tag")).toContain(
      "has no completed release; resuming publication",
    );
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--draft");
    expect(workflow).toContain("electron-builder --mac --arm64 --publish always");
    expect(workflow).toContain("gh release edit");
    expect(workflow).toContain("--draft=false");
    expect(workflowStepSecrets(workflow, "Check out release history")).toEqual(
      [],
    );
    expect(workflowStepSecrets(workflow, "Set up Bun")).toEqual([]);
    expect(
      workflowStepSecrets(workflow, "Resolve release version and tag"),
    ).toEqual([
      "GITHUB_TOKEN",
      "MAC_CSC_LINK",
      "MAC_CSC_KEY_PASSWORD",
      "APPLE_API_KEY",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
      "APPLE_TEAM_ID",
    ]);
    expect(workflowStepSecrets(workflow, "Install dependencies")).toEqual([]);
    expect(workflowStepSecrets(workflow, "Lint")).toEqual([]);
    expect(workflowStepSecrets(workflow, "Test")).toEqual([]);
    expect(
      workflowStepSecrets(workflow, "Build renderer and processes"),
    ).toEqual([]);
    expect(workflowStepSecrets(workflow, "Create draft release")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflowStep(workflow, "Create draft release")).toContain(
      "--json isDraft",
    );
    expect(workflowStep(workflow, "Create draft release")).toContain(
      "refusing to replace its assets",
    );
    expect(
      workflowStepSecrets(workflow, "Prepare App Store Connect API key"),
    ).toEqual(["APPLE_API_KEY"]);
    expect(
      workflowStepSecrets(
        workflow,
        "Build, sign, notarize, and upload arm64 artifacts",
      ),
    ).toEqual([
      "GITHUB_TOKEN",
      "MAC_CSC_LINK",
      "MAC_CSC_KEY_PASSWORD",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
      "APPLE_TEAM_ID",
    ]);
    expect(
      workflowStepSecrets(workflow, "Remove App Store Connect API key"),
    ).toEqual([]);
    expect(
      workflowStepSecrets(workflow, "Verify published update artifacts"),
    ).toEqual(["GITHUB_TOKEN"]);
    expect(workflowStepSecrets(workflow, "Publish completed release")).toEqual([
      "GITHUB_TOKEN",
    ]);
    expect(workflow).toContain(
      "APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY }}",
    );
    expect(workflow).toContain(
      'key_path="${RUNNER_TEMP}/app-store-connect-api-key.p8"',
    );
    expect(workflow).toContain('base64 -D > "${key_path}"');
    expect(workflow).not.toContain("GITHUB_ENV");
    expect(workflow).toContain(
      "APPLE_API_KEY: ${{ runner.temp }}/app-store-connect-api-key.p8",
    );
    expect(workflow).toContain("Remove App Store Connect API key");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      'rm -f "${RUNNER_TEMP}/app-store-connect-api-key.p8"',
    );
    expect(workflow).toContain(
      'gh release view "${RELEASE_TAG}" --json assets',
    );
    expect(workflow).toContain("'.assets[].name'");
    expect(workflow).toContain("Draft release is missing ${expected_asset}.");
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
