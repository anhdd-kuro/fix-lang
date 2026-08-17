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
 * `normalizeReleaseNotes` is now imported by BOTH paths — that migration
 * mattered more than the others, because the stable path is the one every
 * user hits on every routine check, so leaving it on an un-hardened copy put
 * the hardening on the rarer surface only. Do not re-fork it: the truncation
 * rules below are what the shared `<ReleaseNotes>` component is rendered
 * against.
 *
 * `updateService.ts` still carries its own `isRecord` and its own
 * `expectedDmgSize` — both are shape checks with no security-relevant
 * divergence, so they are left alone rather than churned.
 */

export const RELEASE_NOTES_MAX_LENGTH = 12_000;

/**
 * Appended whenever notes were cut, so the reader can tell "the release said
 * this much" from "we stopped here". Language-neutral on purpose: this leaf
 * is dependency-free and has no access to the renderer's `t()`.
 */
export const RELEASE_NOTES_TRUNCATION_MARKER = "\n\n…";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Cuts at `maxLength` UTF-16 code units, then backs off one unit when that
 * landed between the halves of a surrogate pair. `String.prototype.slice`
 * counts code units, so an astral character straddling the limit otherwise
 * leaves a lone high surrogate — `isWellFormed()` false, and a replacement
 * glyph in the About panel. Backing off keeps the byte bound the limit
 * exists for, which slicing by code point would not.
 */
const sliceWithoutSplittingSurrogatePair = (
  text: string,
  maxLength: number,
): string => {
  const cut = text.slice(0, maxLength);
  const lastUnit = cut.charCodeAt(cut.length - 1);
  const endsOnLoneHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return endsOnLoneHighSurrogate ? cut.slice(0, -1) : cut;
};

/**
 * The fence token left unclosed by a cut, or null when every fence is
 * balanced. Release notes are rendered through `ReactMarkdown` + `remarkGfm`,
 * so a cut landing inside a ``` block turns the rest of the update panel into
 * one code block; closing the fence keeps the damage inside the truncated
 * notes. Matches CommonMark's rule that a closing fence uses the same
 * character and is at least as long as the opener.
 */
const danglingCodeFence = (text: string): string | null => {
  let open: string | null = null;
  for (const line of text.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence) continue;
    if (open === null) open = fence;
    else if (fence[0] === open[0] && fence.length >= open.length) open = null;
  }
  return open;
};

/**
 * Unicode characters that change how text is DISPLAYED without changing the
 * string itself — the explicit embeddings and overrides (U+202A–U+202E), the
 * isolates (U+2066–U+2069), and the implicit marks (U+200E, U+200F, U+061C).
 *
 * They matter here because release notes are attacker-influenceable text
 * rendered next to an install button, through a markdown link renderer whose
 * visible label is already independent of its href. An override lets the
 * label a careful reader inspects differ from the label the string contains,
 * which removes the last way to notice a mismatched link by looking at it.
 *
 * Deliberately NOT a general "invisible character" sweep: zero-width joiners
 * and variation selectors carry real meaning in emoji and in Indic scripts,
 * and stripping them would corrupt legitimate notes. Only characters whose
 * sole effect is reordering are listed. The implicit marks are included
 * because FixLang ships English and Japanese, neither of which needs them for
 * correct display, so their only remaining use here is spoofing.
 */
const BIDI_CONTROL_CHARACTERS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export const normalizeReleaseNotes = (
  raw: string | undefined,
): string | undefined => {
  // Stripped BEFORE the length test, so the limit is measured on the text the
  // reader will actually see and a note padded with controls cannot be pushed
  // over the cut by characters that render as nothing.
  const trimmed = raw?.replace(BIDI_CONTROL_CHARACTERS, "").trim();
  if (!trimmed || trimmed.length === 0) return undefined;
  if (trimmed.length <= RELEASE_NOTES_MAX_LENGTH) return trimmed;

  const cut = sliceWithoutSplittingSurrogatePair(
    trimmed,
    RELEASE_NOTES_MAX_LENGTH,
  );
  const unclosedFence = danglingCodeFence(cut);
  return `${cut}${unclosedFence ? `\n${unclosedFence}` : ""}${RELEASE_NOTES_TRUNCATION_MARKER}`;
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
