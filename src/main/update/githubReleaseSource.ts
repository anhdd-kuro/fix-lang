const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/anhdd-kuro/fix-lang/releases/latest";

const REQUEST_TIMEOUT_MS = 10_000;

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

export type GitHubReleaseSource = Readonly<{
  getLatestRelease: () => Promise<unknown>;
}>;

/**
 * Fetches only the fixed, public GitHub Releases endpoint. The response remains
 * unknown until the update service validates its release metadata.
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
});
