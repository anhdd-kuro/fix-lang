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

describe("public GitHub Releases update distribution", () => {
  it("declares a stable public update feed in the application package", () => {
    const packageJson = readPackageJson();
    const build = buildConfiguration(packageJson);

    expect(packageJson.version).toBe("0.2.0");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "https://github.com/anhdd-kuro/fix-lang.git",
    });
    expect(packageJson.dependencies).toMatchObject({
      "electron-updater": expect.any(String),
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

  it("publishes a signed arm64 release only when a matching version tag is pushed", () => {
    const workflowPath = ".github/workflows/release.yml";
    const fullPath = path.join(projectRoot, workflowPath);
    expect(existsSync(fullPath), `${workflowPath} must exist`).toBe(true);

    const workflow = readFileSync(fullPath, "utf8");
    expect(workflow).toMatch(/tags:\s*\[\s*['\"]v\*\.\*\.\*['\"]\s*\]/);
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run test");
    expect(workflow).toContain("Verify release tag matches package version");
    expect(workflow).toContain("package.json");
    expect(workflow).toContain("GITHUB_REF_NAME");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--draft");
    expect(workflow).toContain("electron-builder --mac --arm64 --publish always");
    expect(workflow).toContain("gh release edit");
    expect(workflow).toContain("--draft=false");
    expect(workflow).toContain("CSC_LINK: ${{ secrets.MAC_CSC_LINK }}");
    expect(workflow).toContain(
      "CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}",
    );
    expect(workflow).toContain("APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}");
    expect(workflow).toContain(
      "APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}",
    );
    expect(workflow).toContain(
      "APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}",
    );
    expect(workflow).toContain("APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}");
    expect(workflow).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  });
});
