import { logger } from "~/main/logging/logService";
import {
  comparePrereleaseOrder,
  parsePrereleaseVersion,
  type PrereleaseVersion,
} from "./prereleaseVersion";
import {
  expectedDmgSize,
  isRecord,
  normalizeReleaseNotes,
} from "./releaseAsset";

const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/anhdd-kuro/fix-lang/releases/latest";

/**
 * `/releases/latest` never returns a prerelease, so beta discovery pages the
 * release-*list* endpoint, which returns drafts and prereleases too.
 */
const GITHUB_RELEASE_LIST_URL =
  "https://api.github.com/repos/anhdd-kuro/fix-lang/releases";

const LOG_SCOPE = "update.prereleaseScan";

/**
 * Bounds the request AND the body read: a server that sends headers then
 * stalls the body would otherwise hang forever, latching
 * `checkForPrerelease`'s re-entrancy guard on `checking` until a restart.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** GitHub's page-size ceiling; also this source's per-request growth bound. */
const RELEASE_LIST_PAGE_SIZE = 100;

/**
 * A hard page cap keeps a misbehaving `Link` header from turning this into
 * unbounded fetch/parse work on the main process; three pages of 100 covers
 * months of releases at this repo's cadence.
 */
const RELEASE_LIST_MAX_PAGES = 3;

type GitHubResponse = Readonly<{
  ok: boolean;
  status: number;
  /** Absent in test doubles that don't model pagination; treated as "no next page". */
  headers?: Readonly<{ get: (name: string) => string | null }>;
  json: () => Promise<unknown>;
}>;

export type GitHubFetch = (
  url: string,
  init: Readonly<{
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
  }>,
) => Promise<GitHubResponse>;

export type PrereleaseCandidate = Readonly<{
  version: PrereleaseVersion;
  releaseNotes?: string;
  dmgSize: number;
}>;

export type GitHubReleaseSource = Readonly<{
  getLatestRelease: () => Promise<unknown>;
  /**
   * Rejects only when the scan produced nothing AND could not complete —
   * never over a single malformed item, or a failed page past the first.
   */
  getLatestPrerelease: () => Promise<PrereleaseCandidate | null>;
}>;

/**
 * Origin + path match against the endpoint this scan started from. A `Link`
 * target is untrusted response data: unchecked, it could point the scan at any
 * host or scheme and that payload would be shown as FixLang's release list.
 */
const isReleaseListUrl = (candidate: string): boolean => {
  try {
    const parsed = new URL(candidate);
    if (`${parsed.origin}${parsed.pathname}` === GITHUB_RELEASE_LIST_URL) {
      return true;
    }
    /**
     * GitHub may spell its own `next` link by repository ID
     * (`/repositories/<id>/releases`) rather than the requested path. The ID
     * goes unchecked: a match only decides whether to keep paging.
     */
    return (
      parsed.origin === new URL(GITHUB_RELEASE_LIST_URL).origin &&
      /^\/repositories\/\d+\/releases$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
};

const nextPageNumber = (candidate: string): number | null => {
  if (!isReleaseListUrl(candidate)) return null;
  const raw = new URL(candidate).searchParams.get("page");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 1 ? page : null;
};

/**
 * Rebuilt from this module's own constant using nothing from the header but a
 * validated page NUMBER, so no request URL is composed out of response data.
 */
const nextPageUrl = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (!match) continue;
    const page = nextPageNumber(match[1]);
    if (page !== null) {
      return `${GITHUB_RELEASE_LIST_URL}?per_page=${RELEASE_LIST_PAGE_SIZE}&page=${page}`;
    }
    logger.warn(
      LOG_SCOPE,
      "Ignored a release-list Link header pointing away from the release-list endpoint",
    );
    return null;
  }
  return null;
};

/**
 * Null when only this item is disqualified, so one malformed release in the
 * list never fails the whole scan.
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
 * `getLatestRelease` returns the `/releases/latest` body UNVALIDATED —
 * `updateService.ts` owns that. `getLatestPrerelease` validates the release
 * list item by item and returns only the winner.
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
    let winner: PrereleaseCandidate | null = null;
    let url: string | null =
      `${GITHUB_RELEASE_LIST_URL}?per_page=${RELEASE_LIST_PAGE_SIZE}`;

    /**
     * A failure past page 1 must not discard an already-validated winner, nor
     * report a partial scan that found nothing as "no beta exists". Every way
     * a page can fail routes through here.
     */
    const failPage = (error: Error): PrereleaseCandidate => {
      if (!winner) throw error;
      logger.warn(LOG_SCOPE, "Returning the beta found before the scan failed", {
        reason: error.message,
      });
      return winner;
    };

    for (let page = 0; page < RELEASE_LIST_MAX_PAGES && url; page += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let payload: unknown;

      try {
        const response = await fetchLatest(url, {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          // Thrown so every page failure leaves through the one `catch` below.
          throw new Error(
            `GitHub release list request failed (${response.status})`,
          );
        }

        payload = await response.json();
        url = nextPageUrl(response.headers?.get("link") ?? null);
      } catch (error) {
        return failPage(
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!Array.isArray(payload)) {
        return failPage(
          new Error("GitHub release list response was not an array"),
        );
      }

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
    }

    // A next page still on offer means the cap cut the scan short: this winner
    // is the best of what was READ, not of what was published.
    if (url) {
      logger.warn(
        LOG_SCOPE,
        "Release-list scan stopped at the page budget; older releases were not read",
        { pages: RELEASE_LIST_MAX_PAGES, foundBeta: winner !== null },
      );
    }

    return winner;
  },
});
