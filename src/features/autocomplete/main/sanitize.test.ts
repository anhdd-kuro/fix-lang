import { describe, expect, it } from "vitest";
import { MAX_SUGGESTION_CHARS, sanitizeSuggestion } from "./sanitize";

describe("sanitizeSuggestion", () => {
  it("returns an ordinary continuation unchanged", () => {
    expect(sanitizeSuggestion(" the rest of the sentence.")).toBe(
      " the rest of the sentence.",
    );
  });

  // Leading whitespace is the difference between continuing a word and
  // starting the next one, so it must survive.
  it("keeps leading whitespace but drops trailing whitespace", () => {
    expect(sanitizeSuggestion("  and then  ")).toBe("  and then");
  });

  describe("nothing to show", () => {
    it.each([
      ["an empty string", ""],
      ["whitespace only", "   \n  "],
      ["a non-string", 42],
      ["null", null],
      ["undefined", undefined],
      ["an empty fenced block", "```\n```"],
    ])("returns null for %s", (_description, input) => {
      expect(sanitizeSuggestion(input)).toBeNull();
    });
  });

  describe("model output habits", () => {
    it("strips a fenced block with a language tag", () => {
      expect(sanitizeSuggestion("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
    });

    it("strips a fenced block with no language tag", () => {
      expect(sanitizeSuggestion("```\ncontinuation\n```")).toBe("continuation");
    });

    it.each([
      ["straight double quotes", '"a continuation"', "a continuation"],
      ["straight single quotes", "'a continuation'", "a continuation"],
      ["curly double quotes", "“a continuation”", "a continuation"],
      ["backticks", "`a continuation`", "a continuation"],
    ])("strips wrapping %s", (_description, input, expected) => {
      expect(sanitizeSuggestion(input)).toBe(expected);
    });

    // A continuation may legitimately OPEN a quotation. Stripping an unmatched
    // quote would delete a character the user wanted.
    it("keeps an unmatched opening quote", () => {
      expect(sanitizeSuggestion(' he said "yes')).toBe(' he said "yes');
    });

    it("keeps quotes that are inside the text rather than wrapping it", () => {
      expect(sanitizeSuggestion('say "hi" to them')).toBe('say "hi" to them');
    });

    // A lone quote character is not a wrapping pair.
    it("keeps a single quote character", () => {
      expect(sanitizeSuggestion('"')).toBe('"');
    });
  });

  describe("control characters", () => {
    it("strips a carriage return that would become a phantom line break", () => {
      expect(sanitizeSuggestion("one\r\ntwo")).toBe("one\ntwo");
    });

    it("keeps tabs and newlines", () => {
      expect(sanitizeSuggestion("one\n\ttwo")).toBe("one\n\ttwo");
    });

    it("strips C0 controls", () => {
      expect(sanitizeSuggestion("safe\x00\x07text")).toBe("safetext");
    });

    it("strips C1 controls", () => {
      expect(sanitizeSuggestion("safe\x85\x9ftext")).toBe("safetext");
    });

    it("returns null when the text was only control characters", () => {
      expect(sanitizeSuggestion("\x00\x1f\x7f")).toBeNull();
    });
  });

  /**
   * Ghost text paints through a plain mirror span and is accepted into a plain
   * textarea, so markdown never renders there today — the guarantee is that it
   * cannot start to, and that a Tab press inserts prose rather than markup
   * pointing at a URL the model chose.
   */
  describe("markdown images", () => {
    it("strips a complete image, keeping the prose around it", () => {
      expect(sanitizeSuggestion(" and here ![alt](https://example.com/x.png) it is")).toBe(
        " and here  it is",
      );
    });

    it("strips an image with no alt text", () => {
      expect(sanitizeSuggestion("see ![](data:image/png;base64,AAAA)")).toBe("see");
    });

    it("returns null when the suggestion was only an image", () => {
      expect(sanitizeSuggestion("![alt](https://example.com/x.png)")).toBeNull();
    });

    /**
     * Links are deliberately left alone: they render as literal characters
     * everywhere a suggestion can reach, they fetch nothing on their own, and
     * bracketed text followed by a parenthesis is prose a user may well be
     * mid-way through typing.
     */
    it("keeps a markdown link, which is ordinary text here", () => {
      expect(sanitizeSuggestion(" see [the docs](https://example.com)")).toBe(
        " see [the docs](https://example.com)",
      );
    });

    // An unterminated `![` must not swallow the rest of a multi-line suggestion.
    it("leaves an incomplete image alone rather than eating what follows", () => {
      expect(sanitizeSuggestion("![alt\nthe real continuation")).toBe(
        "![alt\nthe real continuation",
      );
    });
  });

  describe("length cap", () => {
    it("caps an overlong suggestion", () => {
      const suggestion = sanitizeSuggestion("a".repeat(MAX_SUGGESTION_CHARS + 50));

      expect(suggestion).toHaveLength(MAX_SUGGESTION_CHARS);
    });

    // Cutting mid-string can land on a space; that trailing gap must not survive
    // the cap the way it does not survive the raw input.
    it("does not leave trailing whitespace created by the cap", () => {
      const input = `${"a".repeat(MAX_SUGGESTION_CHARS - 1)}   tail`;

      expect(sanitizeSuggestion(input)).toBe("a".repeat(MAX_SUGGESTION_CHARS - 1));
    });
  });
});
