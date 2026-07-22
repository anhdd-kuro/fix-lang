import { describe, expect, it, vi } from "vitest";
import { createGitHubReleaseSource } from "./githubReleaseSource";

describe("GitHub release source", () => {
  it("requests the public latest-release endpoint with fixed headers", async () => {
    const payload = { tag_name: "v0.2.0" };
    const fetchLatest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
    });
    const source = createGitHubReleaseSource(fetchLatest);

    await expect(source.getLatestRelease()).resolves.toEqual(payload);
    expect(fetchLatest).toHaveBeenCalledWith(
      "https://api.github.com/repos/anhdd-kuro/fix-lang/releases/latest",
      expect.objectContaining({
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects unsuccessful responses without parsing their body", async () => {
    const json = vi.fn();
    const source = createGitHubReleaseSource(
      vi.fn().mockResolvedValue({ ok: false, status: 403, json }),
    );

    await expect(source.getLatestRelease()).rejects.toThrow(
      "GitHub release request failed (403)",
    );
    expect(json).not.toHaveBeenCalled();
  });
});
