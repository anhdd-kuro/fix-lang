/**
 * Release-asset validation shared by the stable (`updateService.ts`) and
 * pre-release (`githubReleaseSource.ts`) discovery paths; keyed on a version's
 * `raw` string so neither caller imports the other's version type. Do not
 * re-fork `normalizeReleaseNotes` — its truncation rules are what the shared
 * `<ReleaseNotes>` component is rendered against.
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "~/main/jsonValue";

export const RELEASE_NOTES_MAX_LENGTH = 12_000;

/**
 * Appended whenever notes were cut. Language-neutral: this leaf is
 * dependency-free and has no access to the renderer's `t()`.
 */
export const RELEASE_NOTES_TRUNCATION_MARKER = "\n\n…";

/**
 * Deliberately NOT `isJsonObject`: that one tests `instanceof Object`, which
 * is false for a null-prototype object. A schema keeps both shapes accepted.
 */
const JsonObjectSchema = z.record(z.string(), z.json());

export const isRecord = (value: JsonValue | undefined): value is JsonObject =>
  JsonObjectSchema.safeParse(value).success;

/**
 * `slice` counts UTF-16 code units, so an astral character straddling the
 * limit leaves a lone high surrogate — a replacement glyph in the About panel.
 * Backing off one unit keeps the byte bound intact.
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
 * A cut landing inside a ``` block would turn the rest of the update panel
 * into one code block under `ReactMarkdown`. Matches CommonMark: a closing
 * fence repeats the opener's character and is at least as long.
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
 * Characters whose sole effect is reordering displayed text. Release notes are
 * attacker-influenceable text rendered next to an install button, and an
 * override lets the link label a reader inspects differ from the string's real
 * content. Deliberately not a general invisible-character sweep: ZWJ and
 * variation selectors carry real meaning in emoji and Indic scripts.
 */
const BIDI_CONTROL_CHARACTERS =
  /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export const normalizeReleaseNotes = (
  raw: string | undefined,
): string | undefined => {
  // Stripped before the length test, so a note padded with controls cannot be
  // pushed over the cut by characters that render as nothing.
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

/** The DMG basename electron-builder produces, per `build.mac.artifactName`. */
export const releaseDmgName = (version: Readonly<{ raw: string }>): string =>
  `FixLang-${version.raw}-arm64.dmg`;

/** A fully uploaded asset with a positive, safe-integer byte size. */
const UploadedAssetSchema = z.object({
  name: z.string(),
  state: z.literal("uploaded"),
  size: z.number().int().positive(),
});

/** A non-array `assets` cannot hold the DMG, so it yields no size. */
const ReleaseAssetListSchema = z.array(z.json());

export const expectedDmgSize = (
  assets: JsonValue | undefined,
  version: Readonly<{ raw: string }>,
): number | null => {
  const list = ReleaseAssetListSchema.safeParse(assets);
  if (!list.success) return null;
  const expectedName = releaseDmgName(version);

  for (const candidate of list.data) {
    const asset = UploadedAssetSchema.safeParse(candidate);
    if (asset.success && asset.data.name === expectedName) {
      return asset.data.size;
    }
  }
  return null;
};
