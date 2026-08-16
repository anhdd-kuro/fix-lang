import { describe, expect, it, vi } from "vitest";
import { createGitHubReleaseSource } from "./githubReleaseSource";

/**
 * A release-list entry that passes every validation check.
 *
 * `overrides` patches top-level release fields (tag_name, draft,
 * prerelease, body, or a fully-replaced assets array). `assetOverrides`
 * patches only the single DMG asset's own fields (state, size) while
 * keeping its `name` in sync with whatever tag this item ends up carrying.
 *
 * That name/tag sync matters: an earlier version of this fixture built
 * `assets` from the `tagName` argument before `overrides` was spread, so a
 * case overriding `tag_name` (or the asset's `state`/`size` via a full
 * `assets` replacement naming a *different* tag) got dropped by the
 * name-match branch regardless of which rule it claimed to pin. Deriving
 * the expected name from the item's *final* tag_name, and only ever
 * patching individual asset fields rather than replacing the array,
 * keeps each drop-rule test isolated to the one rule it names.
 */
const validPrereleaseItem = (
  tagName: string,
  overrides: Record<string, unknown> = {},
  assetOverrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const finalTagName =
    typeof overrides.tag_name === "string" ? overrides.tag_name : tagName;
  const rawVersion = finalTagName.startsWith("v")
    ? finalTagName.slice(1)
    : finalTagName;

  return {
    tag_name: tagName,
    draft: false,
    prerelease: true,
    body: "Beta notes.",
    assets: [
      {
        name: `FixLang-${rawVersion}-arm64.dmg`,
        state: "uploaded",
        size: 1,
        ...assetOverrides,
      },
    ],
    ...overrides,
  };
};

const listResponse = (payload: unknown, linkHeader: string | null = null) => ({
  ok: true,
  status: 200,
  headers: { get: vi.fn().mockReturnValue(linkHeader) },
  json: vi.fn().mockResolvedValue(payload),
});

describe("GitHub release source", () => {
  describe("getLatestRelease (stable)", () => {
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

  describe("getLatestPrerelease (beta discovery)", () => {
    it("requests the release-list endpoint with the same fixed headers", async () => {
      const fetchLatest = vi
        .fn()
        .mockResolvedValue(listResponse([validPrereleaseItem("v1.2.3-beta.1")]));
      const source = createGitHubReleaseSource(fetchLatest);

      await source.getLatestPrerelease();

      expect(fetchLatest).toHaveBeenCalledWith(
        "https://api.github.com/repos/anhdd-kuro/fix-lang/releases?per_page=100",
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
        vi.fn().mockResolvedValue({ ok: false, status: 500, json }),
      );

      await expect(source.getLatestPrerelease()).rejects.toThrow(
        "GitHub release list request failed (500)",
      );
      expect(json).not.toHaveBeenCalled();
    });

    it("rejects a non-array response whole, rather than salvaging anything from it", async () => {
      const source = createGitHubReleaseSource(
        vi.fn().mockResolvedValue(listResponse({ tag_name: "v1.2.3-beta.1" })),
      );

      await expect(source.getLatestPrerelease()).rejects.toThrow(
        "GitHub release list response was not an array",
      );
    });

    it("resolves null when the list is empty", async () => {
      const source = createGitHubReleaseSource(
        vi.fn().mockResolvedValue(listResponse([])),
      );

      await expect(source.getLatestPrerelease()).resolves.toBeNull();
    });

    it("returns the fully validated candidate for a single valid item", async () => {
      const source = createGitHubReleaseSource(
        vi
          .fn()
          .mockResolvedValue(listResponse([validPrereleaseItem("v1.2.3-beta.4")])),
      );

      await expect(source.getLatestPrerelease()).resolves.toEqual({
        version: { raw: "1.2.3-beta.4", major: 1, minor: 2, patch: 3, beta: 4 },
        dmgSize: 1,
        releaseNotes: "Beta notes.",
      });
    });

    it("picks the greatest surviving item, ordered by the prerelease version module", async () => {
      const source = createGitHubReleaseSource(
        vi.fn().mockResolvedValue(
          listResponse([
            validPrereleaseItem("v1.2.3-beta.9"),
            validPrereleaseItem("v1.2.3-beta.10"),
            validPrereleaseItem("v1.2.2-beta.99"),
          ]),
        ),
      );

      const result = await source.getLatestPrerelease();
      expect(result?.version.raw).toBe("1.2.3-beta.10");
    });

    it.each([
      ["a draft release", { draft: true }, {}],
      ["a release with prerelease not exactly true", { prerelease: false }, {}],
      [
        "a release with prerelease as a truthy non-boolean",
        { prerelease: "true" },
        {},
      ],
      ["a release missing the prerelease flag", { prerelease: undefined }, {}],
      [
        "a tag outside the vX.Y.Z-beta.N grammar",
        { tag_name: "v1.2.3-rc.1" },
        {},
      ],
      ["a tag with no v prefix", { tag_name: "1.2.3-beta.1" }, {}],
      [
        "a release missing its DMG asset",
        { assets: [{ name: "other.dmg", state: "uploaded", size: 1 }] },
        {},
      ],
      [
        "a release whose DMG asset is not uploaded",
        {},
        { state: "pending" },
      ],
      [
        "a release whose DMG asset has non-positive size",
        {},
        { size: 0 },
      ],
      ["a release with a non-string body", { body: 42 }, {}],
    ] as const)(
      "drops %s without failing the whole batch",
      async (_label, overrides, assetOverrides) => {
        const good = validPrereleaseItem("v0.9.0-beta.1");
        const bad = validPrereleaseItem(
          "v9.9.9-beta.9",
          overrides as Record<string, unknown>,
          assetOverrides as Record<string, unknown>,
        );
        const source = createGitHubReleaseSource(
          vi.fn().mockResolvedValue(listResponse([bad, good])),
        );

        const result = await source.getLatestPrerelease();
        expect(result?.version.raw).toBe("0.9.0-beta.1");
      },
    );

    it("follows the Link header to a second page when the beta isn't on the first", async () => {
      const page1 = listResponse(
        [validPrereleaseItem("v1.0.0-beta.1", { draft: true })],
        '<https://api.github.com/repos/anhdd-kuro/fix-lang/releases?per_page=100&page=2>; rel="next"',
      );
      const page2 = listResponse([validPrereleaseItem("v0.9.0-beta.1")]);
      const fetchLatest = vi
        .fn()
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);
      const source = createGitHubReleaseSource(fetchLatest);

      const result = await source.getLatestPrerelease();

      expect(result?.version.raw).toBe("0.9.0-beta.1");
      expect(fetchLatest).toHaveBeenCalledTimes(2);
      expect(fetchLatest).toHaveBeenNthCalledWith(
        2,
        "https://api.github.com/repos/anhdd-kuro/fix-lang/releases?per_page=100&page=2",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("stops paging at the page budget even if the Link header keeps offering a next page", async () => {
      const alwaysNextPage = () =>
        listResponse(
          [validPrereleaseItem("v1.0.0-beta.1", { draft: true })],
          '<https://api.github.com/repos/anhdd-kuro/fix-lang/releases?per_page=100&page=99>; rel="next"',
        );
      const fetchLatest = vi
        .fn()
        .mockResolvedValueOnce(alwaysNextPage())
        .mockResolvedValueOnce(alwaysNextPage())
        .mockResolvedValueOnce(alwaysNextPage())
        .mockResolvedValueOnce(alwaysNextPage());
      const source = createGitHubReleaseSource(fetchLatest);

      const result = await source.getLatestPrerelease();

      expect(result).toBeNull();
      expect(fetchLatest).toHaveBeenCalledTimes(3);
    });

    it("resolves null when every item is dropped", async () => {
      const source = createGitHubReleaseSource(
        vi
          .fn()
          .mockResolvedValue(
            listResponse([validPrereleaseItem("v1.0.0-beta.1", { draft: true })]),
          ),
      );

      await expect(source.getLatestPrerelease()).resolves.toBeNull();
    });

    it("trims and truncates release notes exactly as the stable path does", async () => {
      const longNotes = "x".repeat(12_050);
      const source = createGitHubReleaseSource(
        vi.fn().mockResolvedValue(
          listResponse([
            validPrereleaseItem("v1.0.0-beta.1", { body: `  ${longNotes}  ` }),
          ]),
        ),
      );

      const result = await source.getLatestPrerelease();
      expect(result?.releaseNotes).toHaveLength(12_000);
      expect(result?.releaseNotes).toBe(longNotes.slice(0, 12_000));
    });

    it("normalizes an empty or whitespace-only body to undefined notes", async () => {
      const source = createGitHubReleaseSource(
        vi.fn().mockResolvedValue(
          listResponse([validPrereleaseItem("v1.0.0-beta.1", { body: "   " })]),
        ),
      );

      const result = await source.getLatestPrerelease();
      expect(result?.releaseNotes).toBeUndefined();
    });

    it("normalizes a null body (no release notes) to undefined", async () => {
      const source = createGitHubReleaseSource(
        vi.fn().mockResolvedValue(
          listResponse([validPrereleaseItem("v1.0.0-beta.1", { body: null })]),
        ),
      );

      const result = await source.getLatestPrerelease();
      expect(result?.releaseNotes).toBeUndefined();
    });
  });
});
