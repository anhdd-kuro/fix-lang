/**
 * Release-asset validation shared by the stable (`updateService.ts`) and
 * pre-release (`githubReleaseSource.ts`) discovery paths. Dependency-free,
 * like `prereleaseVersion.ts` — every helper here only needs a version's
 * `raw` string, not either module's own version type, so both interoperate
 * by shape rather than by importing one another's types.
 *
 * This module exists because the stated reason for duplicating these four
 * names across `updateService.ts` and `githubReleaseSource.ts` — an import
 * cycle — does not hold up: `updateService.ts` imports `GitHubReleaseSource`
 * only as `import type`, which is erased at compile time, and it is
 * `index.ts` (a third file) that imports the factory as a value. Nothing
 * stopped either module from importing a shared leaf.
 *
 * `updateService.ts` still carries its own copies of `RELEASE_NOTES_MAX_LENGTH`,
 * `isRecord`, `normalizeReleaseNotes`, and its own `expectedDmgSize` as of
 * this writing — migrating that file is out of this module's scope (it
 * belongs to whichever card owns `updateService.ts`) and is called out
 * separately so that migration can happen without re-deriving any of this.
 */

export const RELEASE_NOTES_MAX_LENGTH = 12_000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeReleaseNotes = (
  raw: string | undefined,
): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed.slice(0, RELEASE_NOTES_MAX_LENGTH)
    : undefined;
};

/**
 * The DMG basename electron-builder produces for a release, from
 * `build.mac.artifactName` (`FixLang-${version}-arm64.dmg`). Also
 * hand-written in `updateService.ts`, `homebrew.ts`, both release
 * workflows, and the config-lock test — this is the one source both
 * modules in this scope can share; unifying the rest is tracked
 * separately.
 */
export const releaseDmgName = (version: Readonly<{ raw: string }>): string =>
  `FixLang-${version.raw}-arm64.dmg`;

/** Size of the expected, fully uploaded DMG asset, or null when absent. */
export const expectedDmgSize = (
  assets: unknown,
  version: Readonly<{ raw: string }>,
): number | null => {
  if (!Array.isArray(assets)) return null;
  const expectedName = releaseDmgName(version);

  const asset = assets.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.name === expectedName &&
      candidate.state === "uploaded" &&
      typeof candidate.size === "number" &&
      Number.isSafeInteger(candidate.size) &&
      candidate.size > 0,
  );
  return isRecord(asset) && typeof asset.size === "number" ? asset.size : null;
};
