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
 * `/releases/latest` never returns a prerelease — that's GitHub's own
 * definition of the endpoint — so beta discovery needs the release-*list*
 * endpoint instead. It returns every release (draft, stable, and
 * prerelease) newest-first, which is why every item below is validated
 * before it is trusted.
 */
const GITHUB_RELEASE_LIST_URL =
  "https://api.github.com/repos/anhdd-kuro/fix-lang/releases";

const LOG_SCOPE = "update.prereleaseScan";

/**
 * Bounds one page: the request AND the body read. Clearing the timer the
 * moment `fetch` resolves would leave `response.json()` covered by nothing,
 * and a server that sends headers then stalls the body (captive portal,
 * proxy, dropped tether) would hang the returned promise forever — which
 * latches `checkForPrerelease`'s re-entrancy guard and leaves the panel
 * stuck on `checking` until the app restarts.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** GitHub's page-size ceiling; also this source's per-request growth bound. */
const RELEASE_LIST_PAGE_SIZE = 100;

/**
 * Caps total pagination work. This repo ships roughly 30 releases in 15
 * days, so a single unpaged page of GitHub's default 30 lets a beta two to
 * three weeks old fall off page one entirely. Three pages of 100 covers
 * roughly five months of releases at that cadence — comfortably past any
 * beta still worth offering — while a hard page cap keeps a misbehaving or
 * malicious `Link` header from turning this into unbounded fetch/parse work
 * on the main process's event loop (the same process that owns the app's
 * global hotkeys). The cap bounds how MANY requests are made;
 * `isReleaseListUrl` is what bounds where they go. Hitting the cap is
 * logged rather than swallowed — see the end of the scan loop.
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
   * `validatePrereleaseItem` below — and never because a page past the
   * first failed once an earlier page already produced a beta. It rejects
   * only when the scan produced nothing AND could not complete.
   */
  getLatestPrerelease: () => Promise<PrereleaseCandidate | null>;
}>;

/**
 * True only for the very release-list endpoint this scan started from,
 * compared on origin + path so a query string may differ but the host,
 * scheme and repo may not.
 *
 * A `Link` target is response data, not something this module composed, so
 * it is untrusted: without this check the header could redirect the scan to
 * any host or scheme (`https://evil.example.com/...`, `file://`,
 * `javascript:`) and that host's payload would be accepted as FixLang's
 * authoritative release list and shown next to the switch-to-beta button.
 */
const isReleaseListUrl = (candidate: string): boolean => {
  try {
    const parsed = new URL(candidate);
    if (`${parsed.origin}${parsed.pathname}` === GITHUB_RELEASE_LIST_URL) {
      return true;
    }
    /**
     * GitHub's other spelling of the same collection. A paginated response may
     * describe its own `next` link by repository ID —
     * `/repositories/<id>/releases` — rather than echoing the
     * `/repos/<owner>/<repo>/releases` path that was requested. Matching only
     * the requested spelling made a legitimate `next` look hostile, stopping
     * the scan at page one and reporting "no beta" while one sat on a later
     * page.
     *
     * `<id>` is NOT checked against this repository, because nothing here
     * knows its numeric ID — and it does not need to. Per `nextPageUrl`, a
     * matched link only decides whether to KEEP PAGING, never where the
     * request goes, so a header naming a foreign repository ID cannot
     * redirect the scan.
     */
    return (
      parsed.origin === new URL(GITHUB_RELEASE_LIST_URL).origin &&
      /^\/repositories\/\d+\/releases$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
};

/**
 * The next page's number, or null when the target is not this collection or
 * carries no usable `page`. Deliberately a NUMBER rather than a URL — see
 * `nextPageUrl`.
 */
const nextPageNumber = (candidate: string): number | null => {
  if (!isReleaseListUrl(candidate)) return null;
  const raw = new URL(candidate).searchParams.get("page");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 1 ? page : null;
};

/**
 * The next page's URL, or null past the last page.
 *
 * Rebuilt from this module's own constant using nothing from the header but a
 * validated page NUMBER, so no request URL is ever composed out of response
 * data. That is what lets `isReleaseListUrl` accept GitHub's by-ID spelling
 * without knowing this repository's ID: the widened match can only let the
 * scan continue, and every continuation goes to the endpoint spelled out here.
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
    let winner: PrereleaseCandidate | null = null;
    let url: string | null =
      `${GITHUB_RELEASE_LIST_URL}?per_page=${RELEASE_LIST_PAGE_SIZE}`;

    /**
     * A page can only fail after an earlier one already produced a fully
     * validated beta once pagination exists, and throwing then would discard
     * a real winner over an unrelated later page (GitHub's unauthenticated
     * limit is 60/hr per address, and this scan spends up to 3 of them). So
     * a failure past page 1 yields the best beta found so far when there is
     * one, and only throws when there is nothing to return — a partial scan
     * that found nothing must not be reported as "no beta exists".
     *
     * Every way a page can fail routes through here, thrown ones included:
     * a rejected `fetch`, an unparseable body, and the request timeout all
     * discard an already-validated winner otherwise, which is the same
     * defect as the status-code path.
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

      // The timer covers the body read too, not just the request — a stalled
      // body is exactly what REQUEST_TIMEOUT_MS exists to bound, on every
      // page and not only the first.
      try {
        const response = await fetchLatest(url, {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          // Thrown rather than returned so every page failure — status,
          // transport, timeout, unparseable body — leaves through the one
          // `catch` below.
          throw new Error(
            `GitHub release list request failed (${response.status})`,
          );
        }

        payload = await response.json();
        url = nextPageUrl(response.headers?.get("link") ?? null);
      } catch (error) {
        // Only this page's I/O is inside the try — item validation happens
        // below — so there is no programming error for this to swallow.
        return failPage(
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        clearTimeout(timeout);
      }

      // Unlike a single bad item, a response that isn't even a list is
      // rejected whole — there's nothing to salvage item by item.
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

    // A next page still on offer means the cap cut the scan short, so this
    // `winner` is the best of what was READ, not of what was published.
    // Returning that silently is indistinguishable from a complete scan.
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
