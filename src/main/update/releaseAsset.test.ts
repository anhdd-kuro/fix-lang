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

    /**
     * Release notes are attacker-influenceable text rendered next to an
     * install button, and the panel next to it renders markdown links whose
     * visible text is independent of their href. A bidi override reorders the
     * DISPLAYED text without changing the logical string, so it is the second
     * half of that deception: the label a careful reader inspects is not the
     * label the string contains.
     */
    describe("bidirectional control characters", () => {
      // Spelled as escapes, never as literals: these characters are invisible
      // in an editor, so a literal in a test file is unreviewable and one
      // careless paste away from being silently deleted.
      it.each([
        ["LEFT-TO-RIGHT EMBEDDING", "\u202A"],
        ["RIGHT-TO-LEFT EMBEDDING", "\u202B"],
        ["POP DIRECTIONAL FORMATTING", "\u202C"],
        ["LEFT-TO-RIGHT OVERRIDE", "\u202D"],
        ["RIGHT-TO-LEFT OVERRIDE", "\u202E"],
        ["LEFT-TO-RIGHT ISOLATE", "\u2066"],
        ["RIGHT-TO-LEFT ISOLATE", "\u2067"],
        ["FIRST STRONG ISOLATE", "\u2068"],
        ["POP DIRECTIONAL ISOLATE", "\u2069"],
        ["LEFT-TO-RIGHT MARK", "\u200E"],
        ["RIGHT-TO-LEFT MARK", "\u200F"],
        ["ARABIC LETTER MARK", "\u061C"],
      ])("strips %s", (_label, control) => {
        expect(normalizeReleaseNotes(`Fixed${control} the updater.`)).toBe(
          "Fixed the updater.",
        );
      });

      /**
       * The canonical Trojan-Source shape: the visible reading of the link
       * label is reversed away from the string that is actually there.
       */
      it("removes an override that would make a link label read as another URL", () => {
        const spoofed =
          "[https://github.com/anhdd-kuro/\u202Egnal-xif\u202C](https://evil.example/phish)";

        expect(normalizeReleaseNotes(spoofed)).toBe(
          "[https://github.com/anhdd-kuro/gnal-xif](https://evil.example/phish)",
        );
      });

      it("normalizes notes made of nothing but control characters to undefined", () => {
        expect(normalizeReleaseNotes("\u202E\u2069\u200F  \n")).toBeUndefined();
      });

      /**
       * The whole risk of this fix is over-stripping. FixLang ships Japanese,
       * and a normalizer that mangled real release notes would be a worse bug
       * than the spoof it prevents — so real CJK, kana, full-width
       * punctuation, emoji and markdown structure are pinned byte for byte.
       *
       * The family emoji is load-bearing, not decoration: it is three code
       * points joined by ZERO WIDTH JOINERs. A "strip every invisible
       * character" sweep — the obvious over-reach here — shatters it into
       * three separate glyphs, and this is the assertion that says so.
       */
      it("leaves Japanese release notes byte-identical", () => {
        const japanese = [
          "## 更新内容",
          "",
          "- プレリリースチャンネルを追加しました（ベータ版）。",
          "- 「元に戻す」ボタンで安定版へ戻せます。",
          "- 設定・プロファイル・APIキー・履歴はそのまま残ります 🎉",
          "- ご家族でお使いの方へ: 👨‍👩‍👧 の表示も変わりません。",
          "",
          "詳しくは README を参照してください。",
        ].join("\n");

        expect(normalizeReleaseNotes(japanese)).toBe(japanese);
      });

      it("leaves the length limit measured on the stripped text", () => {
        const notes = `${"\u202E".repeat(50)}${"z".repeat(RELEASE_NOTES_MAX_LENGTH)}`;

        expect(normalizeReleaseNotes(notes)).toBe(
          "z".repeat(RELEASE_NOTES_MAX_LENGTH),
        );
      });
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
