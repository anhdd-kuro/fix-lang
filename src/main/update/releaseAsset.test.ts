import { describe, expect, it } from "vitest";
import {
  expectedDmgSize,
  isRecord,
  normalizeReleaseNotes,
  RELEASE_NOTES_MAX_LENGTH,
  RELEASE_NOTES_TRUNCATION_MARKER,
  releaseDmgName,
} from "./releaseAsset";

const GRINNING_FACE = "\u{1F600}";

/**
 * What `String.prototype.isWellFormed()` would answer, spelled out because
 * that method is ES2024 and this project targets ES2022 — calling it is a
 * `tsc` error even though vitest, which strips types rather than checking
 * them, would run it happily.
 */
const hasLoneSurrogate = (text: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    text,
  );

describe("release asset helpers", () => {
  describe("normalizeReleaseNotes", () => {
    it("trims and keeps notes that fit the limit byte for byte", () => {
      expect(normalizeReleaseNotes("  Beta notes.  ")).toBe("Beta notes.");
      const exact = "z".repeat(RELEASE_NOTES_MAX_LENGTH);
      expect(normalizeReleaseNotes(exact)).toBe(exact);
    });

    it.each([
      ["undefined", undefined],
      ["an empty string", ""],
      ["whitespace only", "   \n\t "],
    ])("normalizes %s to undefined", (_label, raw) => {
      expect(normalizeReleaseNotes(raw)).toBeUndefined();
    });

    it("marks truncated notes so a cut is not mistaken for the end of the text", () => {
      const truncated = normalizeReleaseNotes("x".repeat(20_000));
      expect(truncated).toBe(
        `${"x".repeat(RELEASE_NOTES_MAX_LENGTH)}${RELEASE_NOTES_TRUNCATION_MARKER}`,
      );
    });

    /**
     * Release notes are attacker-influenceable text rendered next to an
     * install button. `slice` counts UTF-16 code units, so an astral
     * character straddling the limit used to leave a lone high surrogate:
     * `isWellFormed()` false, and a replacement glyph in the About panel.
     */
    it("never cuts between the halves of a surrogate pair", () => {
      // One leading unit makes every pair straddle an odd offset, so the
      // limit lands mid-pair.
      const notes = `a${GRINNING_FACE.repeat(6_100)}`;
      const truncated = normalizeReleaseNotes(notes) ?? "";
      const body = truncated.slice(
        0,
        truncated.length - RELEASE_NOTES_TRUNCATION_MARKER.length,
      );

      expect(hasLoneSurrogate(truncated)).toBe(false);
      expect(body.length).toBe(RELEASE_NOTES_MAX_LENGTH - 1);
      expect(body.endsWith(GRINNING_FACE)).toBe(true);
      expect(truncated.endsWith(RELEASE_NOTES_TRUNCATION_MARKER)).toBe(true);
    });

    it("keeps a cut that lands inside an astral character within the length limit", () => {
      const notes = `a${GRINNING_FACE.repeat(6_100)}`;
      const truncated = normalizeReleaseNotes(notes) ?? "";
      expect(truncated.length).toBeLessThanOrEqual(
        RELEASE_NOTES_MAX_LENGTH + RELEASE_NOTES_TRUNCATION_MARKER.length,
      );
    });

    /**
     * Notes render through `ReactMarkdown` + `remarkGfm`, so a cut landing
     * inside a fence turns the rest of the update panel into one code block.
     */
    it.each([
      ["backtick", "```"],
      ["tilde", "~~~"],
      ["a longer opener", "`````"],
    ])("closes a %s code fence left open by the cut", (_label, fence) => {
      const notes = `${fence}js\n${"y".repeat(20_000)}\n${fence}`;
      const truncated = normalizeReleaseNotes(notes) ?? "";
      const openers = truncated.match(/^ {0,3}(?:`{3,}|~{3,})/gm) ?? [];

      expect(openers).toHaveLength(2);
      expect(truncated.endsWith(`\n${fence}${RELEASE_NOTES_TRUNCATION_MARKER}`)).toBe(
        true,
      );
    });

    it("leaves a balanced fence alone when the cut lands outside it", () => {
      const notes = `\`\`\`js\ncode\n\`\`\`\n${"y".repeat(20_000)}`;
      const truncated = normalizeReleaseNotes(notes) ?? "";
      const openers = truncated.match(/^ {0,3}(?:`{3,}|~{3,})/gm) ?? [];

      expect(openers).toHaveLength(2);
      expect(truncated.endsWith(RELEASE_NOTES_TRUNCATION_MARKER)).toBe(true);
      expect(truncated.endsWith("```")).toBe(false);
    });

    it("does not add a marker or a fence to notes that were not truncated", () => {
      const notes = "```js\ncode\n```";
      expect(normalizeReleaseNotes(notes)).toBe(notes);
    });
  });

  describe("isRecord", () => {
    it.each([
      ["a plain object", {}, true],
      ["a null-prototype object", Object.create(null) as unknown, true],
      ["null", null, false],
      ["undefined", undefined, false],
      ["an array", [], false],
      ["a string", "x", false],
      ["a number", 1, false],
    ])("returns %s -> %s", (_label, value, expected) => {
      expect(isRecord(value)).toBe(expected);
    });
  });

  describe("expectedDmgSize", () => {
    const version = { raw: "1.2.3-beta.4" };
    const asset = (overrides: Record<string, unknown> = {}) => ({
      name: releaseDmgName(version),
      state: "uploaded",
      size: 42,
      ...overrides,
    });

    it("returns the size of the fully uploaded DMG named for the version", () => {
      expect(expectedDmgSize([asset()], version)).toBe(42);
      expect(releaseDmgName(version)).toBe("FixLang-1.2.3-beta.4-arm64.dmg");
    });

    it.each([
      ["assets is not an array", "nope" as unknown],
      ["the asset is named for another version", [asset({ name: "other.dmg" })]],
      ["the asset is still uploading", [asset({ state: "starter" })]],
      ["the size is zero", [asset({ size: 0 })]],
      ["the size is not a safe integer", [asset({ size: 1.5 })]],
      ["the size is not a number", [asset({ size: "42" })]],
    ])("returns null when %s", (_label, assets) => {
      expect(expectedDmgSize(assets, version)).toBeNull();
    });
  });
});
