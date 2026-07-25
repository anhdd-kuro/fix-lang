import { describe, expect, it, vi } from "vitest";
import { createUpdateService } from "./updateService";

const stableRelease = (
  tagName = "v0.2.0",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  tag_name: tagName,
  name: `FixLang ${tagName}`,
  body: "Improved update reliability.",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `FixLang-${tagName.slice(1)}-arm64.dmg`,
      state: "uploaded",
      size: 1,
    },
  ],
  html_url: "https://malicious.example/update",
  ...overrides,
});

const createService = (
  overrides: Partial<{
    isPackaged: boolean;
    platform: string;
    arch: string;
    currentVersion: string;
    getLatestRelease: () => Promise<unknown>;
    onLog: (level: "info" | "warn" | "error", message: string) => void;
  }> = {},
) => {
  const releaseSource = {
    getLatestRelease: vi
      .fn<() => Promise<unknown>>()
      .mockImplementation(
        overrides.getLatestRelease ??
          (() => Promise.resolve(stableRelease())),
      ),
  };
  const service = createUpdateService({
    releaseSource,
    isPackaged: overrides.isPackaged ?? true,
    platform: overrides.platform ?? "darwin",
    arch: overrides.arch ?? "arm64",
    getCurrentVersion: () => overrides.currentVersion ?? "0.1.0",
    onLog: overrides.onLog,
  });

  return { service, releaseSource };
};

describe("unsigned GitHub update service", () => {
  it("does not contact GitHub from development builds", async () => {
    const { service, releaseSource } = createService({ isPackaged: false });

    expect(service.getState()).toMatchObject({
      phase: "unsupported",
      currentVersion: "0.1.0",
    });
    await service.checkForUpdates();

    expect(releaseSource.getLatestRelease).not.toHaveBeenCalled();
  });

  it("does not offer macOS artifacts on unsupported platforms", async () => {
    const { service, releaseSource } = createService({ platform: "win32" });

    await service.checkForUpdates();

    expect(service.getState().phase).toBe("unsupported");
    expect(releaseSource.getLatestRelease).not.toHaveBeenCalled();
  });

  it("does not offer Apple Silicon artifacts to an Intel app", async () => {
    const { service, releaseSource } = createService({ arch: "x64" });

    await service.checkForUpdates();

    expect(service.getState().phase).toBe("unsupported");
    expect(releaseSource.getLatestRelease).not.toHaveBeenCalled();
  });

  it("reports a newer stable release and derives a trusted release URL", async () => {
    const { service, releaseSource } = createService();

    await service.checkForUpdates();

    expect(releaseSource.getLatestRelease).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject({
      phase: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      releaseNotes: "Improved update reliability.",
    });
    expect(service.getReleaseUrl()).toBe(
      "https://github.com/anhdd-kuro/fix-lang/releases/tag/v0.2.0",
    );
    expect(service.getReleaseUrl()).not.toContain("malicious.example");
  });

  it.each([null, undefined])(
    "accepts a stable release whose body is %s",
    async (body) => {
      const { service } = createService({
        getLatestRelease: () =>
          Promise.resolve(stableRelease("v0.2.0", { body })),
      });

      await service.checkForUpdates();

      expect(service.getState()).toMatchObject({
        phase: "available",
        availableVersion: "0.2.0",
      });
      expect(service.getState().releaseNotes).toBeUndefined();
    },
  );

  it.each([
    ["0.10.0", "v0.9.9", "up-to-date"],
    ["0.10.0", "v0.10.0", "up-to-date"],
    ["0.9.9", "v0.10.0", "available"],
  ])(
    "compares current %s with release %s numerically",
    async (currentVersion, releaseVersion, expectedPhase) => {
      const { service } = createService({
        currentVersion,
        getLatestRelease: () =>
          Promise.resolve(stableRelease(releaseVersion)),
      });

      await service.checkForUpdates();

      expect(service.getState().phase).toBe(expectedPhase);
    },
  );

  it.each([
    stableRelease("release-0.2.0"),
    stableRelease("v0.2"),
    stableRelease("v0.2.0-beta.1"),
    stableRelease("v0.2.0", { draft: true }),
    stableRelease("v0.2.0", { prerelease: true }),
    stableRelease("v0.2.0", { assets: [] }),
    stableRelease("v0.2.0", {
      assets: [{ name: "FixLang-0.2.0-arm64.dmg", state: "uploaded", size: 0 }],
    }),
    stableRelease("v0.2.0", { body: 42 }),
    { message: "not a release" },
  ])("rejects malformed or non-stable release metadata", async (release) => {
    const { service } = createService({
      getLatestRelease: () => Promise.resolve(release),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: "Could not check for updates. Try again later.",
    });
    expect(service.getReleaseUrl()).toBeNull();
  });

  it("limits release notes and keeps them as plain text", async () => {
    const longNotes = `<strong>${"x".repeat(13_000)}</strong>`;
    const { service } = createService({
      getLatestRelease: () =>
        Promise.resolve(stableRelease("v0.2.0", { body: longNotes })),
    });

    await service.checkForUpdates();

    expect(service.getState().releaseNotes).toHaveLength(12_000);
    expect(service.getState().releaseNotes?.startsWith("<strong>")).toBe(true);
  });

  it("prevents duplicate checks while the first request is active", async () => {
    let resolveRelease: ((release: unknown) => void) | undefined;
    const pendingRelease = new Promise<unknown>((resolve) => {
      resolveRelease = resolve;
    });
    const { service, releaseSource } = createService({
      getLatestRelease: () => pendingRelease,
    });

    const first = service.checkForUpdates();
    const second = service.checkForUpdates();
    expect(releaseSource.getLatestRelease).toHaveBeenCalledTimes(1);

    resolveRelease?.(stableRelease());
    await Promise.all([first, second]);
  });

  it("redacts remote and local details from errors and logs", async () => {
    const onLog = vi.fn();
    const { service } = createService({
      onLog,
      getLatestRelease: () =>
        Promise.reject(
          new Error(
            "https://private.example/releases?token=secret /Users/kuro/cache",
          ),
        ),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: "Could not check for updates. Try again later.",
    });
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("private.example");
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("token=secret");
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("/Users/kuro");
  });

  it("notifies subscribers with immutable snapshots", async () => {
    const { service } = createService();
    const phases: string[] = [];
    const unsubscribe = service.subscribe((state) => phases.push(state.phase));

    await service.checkForUpdates();
    unsubscribe();

    expect(phases).toEqual(["checking", "available"]);
    expect(Object.isFrozen(service.getState())).toBe(true);
  });
});
