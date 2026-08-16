import {
  comparePrereleaseOrder,
  parsePrereleaseVersion,
  type PrereleaseVersion,
} from "./prereleaseVersion";

const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/anhdd-kuro/fix-lang/releases/latest";

/**
 * `/releases/latest` never returns a prerelease — that's GitHub's own
 * definition of the endpoint — so beta discovery needs the release-*list*
 * endpoint instead. It returns every release (draft, stable, and
 * prerelease) newest-first, which is why every item below is validated
 * before it is trusted.
 */
const GITHUB_RELEASE_LIST_URL =
  "https://api.github.com/repos/anhdd-kuro/fix-lang/releases";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Mirrors `updateService.ts`'s `RELEASE_NOTES_MAX_LENGTH`. Duplicated rather
 * than imported: `updateService.ts` already imports `GitHubReleaseSource`
 * from this file, so importing back would cycle. The two stay in sync by
 * being the same literal, not by sharing a symbol — same reasoning as
 * `prereleaseVersion.ts`'s `OrderableVersion` interoperating with
 * `updateService.ts`'s `StableVersion` by shape rather than by import.
 */
const RELEASE_NOTES_MAX_LENGTH = 12_000;

type GitHubResponse = Readonly<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type GitHubFetch = (
  url: string,
  init: Readonly<{
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
  }>,
) => Promise<GitHubResponse>;

/** A validated beta release: the winner of the release-list scan. */
export type PrereleaseCandidate = Readonly<{
  version: PrereleaseVersion;
  releaseNotes?: string;
  /** DMG byte count from the release asset — same role as the stable path's. */
  dmgSize: number;
}>;

export type GitHubReleaseSource = Readonly<{
  getLatestRelease: () => Promise<unknown>;
  /**
   * Scans the release list for the greatest valid, published beta and
   * returns it already validated, or null when none survives. Never
   * rejects because one malformed item was in the list — see
   * `validatePrereleaseItem` below.
   */
  getLatestPrerelease: () => Promise<PrereleaseCandidate | null>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Size of the expected, fully uploaded DMG asset, or null when absent. */
const expectedDmgSize = (
  assets: unknown,
  version: PrereleaseVersion,
): number | null => {
  if (!Array.isArray(assets)) return null;
  const expectedName = `FixLang-${version.raw}-arm64.dmg`;

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

const normalizeReleaseNotes = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed.slice(0, RELEASE_NOTES_MAX_LENGTH)
    : undefined;
};

/**
 * Validates one release-list entry. Returns null for anything that
 * disqualifies just this item — a draft, `prerelease` not exactly `true`, a
 * tag outside the `vX.Y.Z-beta.N` grammar, or a missing/not-uploaded/
 * non-positive DMG asset — so a single malformed release in the list never
 * fails the whole scan.
 */
const validatePrereleaseItem = (value: unknown): PrereleaseCandidate | null => {
  if (!isRecord(value) || value.draft !== false || value.prerelease !== true) {
    return null;
  }
  if (typeof value.tag_name !== "string") return null;

  const tagMatch = /^v(.+)$/.exec(value.tag_name);
  const version = tagMatch ? parsePrereleaseVersion(tagMatch[1]) : null;
  if (!version) return null;

  const dmgSize = expectedDmgSize(value.assets, version);
  if (dmgSize === null) return null;
  // GitHub returns JSON null when a release has no notes.
  if (value.body != null && typeof value.body !== "string") return null;

  return Object.freeze({
    version,
    dmgSize,
    releaseNotes: normalizeReleaseNotes(
      typeof value.body === "string" ? value.body : undefined,
    ),
  });
};

/**
 * Fetches the public GitHub Releases endpoints. `getLatestRelease` returns
 * the fixed `/releases/latest` body unvalidated — `updateService.ts` still
 * owns that validation. `getLatestPrerelease` is different: the release
 * *list* is untrusted metadata shaped as an array, so this source validates
 * it item by item and returns only the winner, already checked.
 */
export const createGitHubReleaseSource = (
  fetchLatest: GitHubFetch = globalThis.fetch,
): GitHubReleaseSource => ({
  getLatestRelease: async (): Promise<unknown> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchLatest(GITHUB_LATEST_RELEASE_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`GitHub release request failed (${response.status})`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  },

  getLatestPrerelease: async (): Promise<PrereleaseCandidate | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchLatest(GITHUB_RELEASE_LIST_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `GitHub release list request failed (${response.status})`,
        );
      }

      const payload = await response.json();
      // Unlike a single bad item, a response that isn't even a list is
      // rejected whole — there's nothing to salvage item by item.
      if (!Array.isArray(payload)) {
        throw new Error("GitHub release list response was not an array");
      }

      let winner: PrereleaseCandidate | null = null;
      for (const item of payload) {
        const candidate = validatePrereleaseItem(item);
        if (!candidate) continue;
        if (
          !winner ||
          comparePrereleaseOrder(candidate.version, winner.version) > 0
        ) {
          winner = candidate;
        }
      }
      return winner;
    } finally {
      clearTimeout(timeout);
    }
  },
});
