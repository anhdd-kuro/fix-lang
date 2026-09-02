import { describe, expect, it } from "vitest";
import { MAX_SUGGESTION_CHARS, OVERLAP_LOOKBACK_CHARS, sanitizeSuggestion } from "./sanitize";

/**
 * `""` wherever the case is not about the prefix. The overlap guard needs a
 * prefix ending mid-word to fire at all, so an empty one is provably inert and
 * keeps these assertions about the thing they name.
 */
describe("sanitizeSuggestion", () => {
  it("returns an ordinary continuation unchanged", () => {
    expect(sanitizeSuggestion(" the rest of the sentence.", "")).toBe(
      " the rest of the sentence.",
    );
  });

  // Leading whitespace is the difference between continuing a word and
  // starting the next one, so it must survive.
  it("keeps leading whitespace but drops trailing whitespace", () => {
    expect(sanitizeSuggestion("  and then  ", "")).toBe("  and then");
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
      expect(sanitizeSuggestion(input, "")).toBeNull();
    });
  });

  describe("model output habits", () => {
    it("strips a fenced block with a language tag", () => {
      expect(sanitizeSuggestion("```ts\nconst x = 1;\n```", "")).toBe("const x = 1;");
    });

    it("strips a fenced block with no language tag", () => {
      expect(sanitizeSuggestion("```\ncontinuation\n```", "")).toBe("continuation");
    });

    it.each([
      ["straight double quotes", '"a continuation"', "a continuation"],
      ["straight single quotes", "'a continuation'", "a continuation"],
      ["curly double quotes", "“a continuation”", "a continuation"],
      ["backticks", "`a continuation`", "a continuation"],
    ])("strips wrapping %s", (_description, input, expected) => {
      expect(sanitizeSuggestion(input, "")).toBe(expected);
    });

    // A continuation may legitimately OPEN a quotation. Stripping an unmatched
    // quote would delete a character the user wanted.
    it("keeps an unmatched opening quote", () => {
      expect(sanitizeSuggestion(' he said "yes', "")).toBe(' he said "yes');
    });

    it("keeps quotes that are inside the text rather than wrapping it", () => {
      expect(sanitizeSuggestion('say "hi" to them', "")).toBe('say "hi" to them');
    });

    // A lone quote character is not a wrapping pair.
    it("keeps a single quote character", () => {
      expect(sanitizeSuggestion('"', "")).toBe('"');
    });
  });

  describe("control characters", () => {
    it("strips a carriage return that would become a phantom line break", () => {
      expect(sanitizeSuggestion("one\r\ntwo", "")).toBe("one\ntwo");
    });

    it("keeps tabs and newlines", () => {
      expect(sanitizeSuggestion("one\n\ttwo", "")).toBe("one\n\ttwo");
    });

    it("strips C0 controls", () => {
      expect(sanitizeSuggestion("safe\x00\x07text", "")).toBe("safetext");
    });

    it("strips C1 controls", () => {
      expect(sanitizeSuggestion("safe\x85\x9ftext", "")).toBe("safetext");
    });

    it("returns null when the text was only control characters", () => {
      expect(sanitizeSuggestion("\x00\x1f\x7f", "")).toBeNull();
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
      expect(sanitizeSuggestion(" and here ![alt](https://example.com/x.png) it is", "")).toBe(
        " and here  it is",
      );
    });

    it("strips an image with no alt text", () => {
      expect(sanitizeSuggestion("see ![](data:image/png;base64,AAAA)", "")).toBe("see");
    });

    it("returns null when the suggestion was only an image", () => {
      expect(sanitizeSuggestion("![alt](https://example.com/x.png)", "")).toBeNull();
    });

    /**
     * Links are deliberately left alone: they render as literal characters
     * everywhere a suggestion can reach, they fetch nothing on their own, and
     * bracketed text followed by a parenthesis is prose a user may well be
     * mid-way through typing.
     */
    it("keeps a markdown link, which is ordinary text here", () => {
      expect(sanitizeSuggestion(" see [the docs](https://example.com)", "")).toBe(
        " see [the docs](https://example.com)",
      );
    });

    // An unterminated `![` must not swallow the rest of a multi-line suggestion.
    it("leaves an incomplete image alone rather than eating what follows", () => {
      expect(sanitizeSuggestion("![alt\nthe real continuation", "")).toBe(
        "![alt\nthe real continuation",
      );
    });
  });

  describe("length cap", () => {
    it("caps an overlong suggestion", () => {
      const suggestion = sanitizeSuggestion("a".repeat(MAX_SUGGESTION_CHARS + 50), "");

      expect(suggestion).toHaveLength(MAX_SUGGESTION_CHARS);
    });

    // Cutting mid-string can land on a space; that trailing gap must not survive
    // the cap the way it does not survive the raw input.
    it("does not leave trailing whitespace created by the cap", () => {
      const input = `${"a".repeat(MAX_SUGGESTION_CHARS - 1)}   tail`;

      expect(sanitizeSuggestion(input, "")).toBe("a".repeat(MAX_SUGGESTION_CHARS - 1));
    });
  });

  /**
   * The prompt asks for the fragment to APPEND; this is what enforces it.
   * `ornith-1.0-9b` returns the whole word instead of its tail in roughly one
   * reply in eight, and before this guard `tes` + `test` painted `testest` and
   * Tab inserted it.
   */
  describe("overlap with the prefix", () => {
    it("strips a word the model re-emitted instead of completing", () => {
      expect(sanitizeSuggestion("test", "tes")).toBe("t");
    });

    /**
     * OBSERVED LIVE, and pinned verbatim like the refusal strings in
     * `parseReply.test.ts`. Run 12 of 16 against `ornith-1.0-9b` on LM Studio,
     * driving the real prompts with the prefix below, answered
     * `{"suggestion":"test this out."}` — a re-emission carrying a genuine
     * continuation behind it, which is what makes it dangerous: the ghost read
     * `I want to testest this out.` and the sentence after the damage was
     * perfectly sensible.
     */
    it("strips a re-emission the live model actually returned", () => {
      expect(sanitizeSuggestion("test this out.", "I want to tes")).toBe("t this out.");
    });

    it("strips a re-emission of several words, not just the partial one", () => {
      expect(sanitizeSuggestion("run the test suite", "please run the tes")).toBe("t suite");
    });

    // Same defect wearing different capitals. The user's own casing is what
    // survives, because only the suggestion is ever cut.
    it.each([
      ["the whole word", "Test", "t"],
      ["the word and more", "Testing", "ting"],
    ])("strips a case-mismatched re-emission of %s", (_description, suggestion, expected) => {
      expect(sanitizeSuggestion(suggestion, "tes")).toBe(expected);
    });

    // Nothing left to append is no suggestion at all — not an empty ghost, and
    // not a Tab affordance that would insert nothing.
    it("returns null when the model returned exactly what was already typed", () => {
      expect(sanitizeSuggestion("test", "test")).toBeNull();
    });

    it("takes the longest overlap, not the first one that matches", () => {
      expect(sanitizeSuggestion("test tester", "test tes")).toBe("ter");
    });

    /**
     * THE REGRESSION THAT WOULD MAKE THIS GUARD WORSE THAN THE BUG.
     *
     * English repeats words, and the repeat is the text — `had had`, `that
     * that`, `New York, New York`. Every one of these is a genuine continuation
     * whose opening word is already on screen, and every one must arrive
     * untouched.
     *
     * Two independent things save them. The caret sits at a word boundary (a
     * trailing space is a finished word, so the guard never runs), or the
     * suggestion opens with a separator (so no candidate, which always starts
     * with a word character, can match it).
     */
    it.each([
      ["had had", "he had", " had enough to worry about"],
      ["that that", "I know that", " that is the point"],
      ["New York, New York", "we flew to New York, New", " York for the week"],
      ["a repeat after a finished word", "he had ", "had enough to worry about"],
      ["a doubled word the user is typing on purpose", "the the", " the third time"],
    ])("leaves a legitimate repeat alone: %s", (_description, prefix, suggestion) => {
      expect(sanitizeSuggestion(suggestion, prefix)).toBe(suggestion);
    });

    /**
     * The other half of that rule, stated so the boundary is visible: with the
     * caret INSIDE a word, the same words with NO separator are redundancy
     * rather than a repeat, and `he hadhad a point` is what would otherwise
     * paint.
     */
    it("strips the same words when no separator makes them a new word", () => {
      expect(sanitizeSuggestion("had a point", "he had")).toBe(" a point");
    });

    /**
     * DELIBERATELY CONSERVATIVE, and this is the case that fixes the rule.
     *
     * A model that forgets its leading space returns `a lot` after `I like tea`.
     * An overlap allowed to start mid-word would see the trailing `a`, strip it,
     * and delete a word the model meant to ADD. Missing an overlap costs a
     * visibly wrong ghost the user declines; inventing one edits their text.
     */
    it("does not strip an overlap that starts inside a word", () => {
      expect(sanitizeSuggestion("a lot", "I like tea")).toBe("a lot");
    });

    it("ignores an empty prefix rather than treating it as a match", () => {
      expect(sanitizeSuggestion("test", "")).toBe("test");
    });

    describe("look-back bound", () => {
      it("strips a re-emission reaching exactly to the bound", () => {
        const word = "z".repeat(OVERLAP_LOOKBACK_CHARS);

        expect(sanitizeSuggestion(`${word}!`, word)).toBe("!");
      });

      // One character further back and the word start is outside the window, so
      // there is no candidate at all — the guard declines rather than guessing
      // from a partial one.
      it("leaves a re-emission starting beyond the bound alone", () => {
        const word = "z".repeat(OVERLAP_LOOKBACK_CHARS + 1);

        expect(sanitizeSuggestion(`${word}!`, word)).toBe(`${word}!`);
      });
    });

    // The comparison has to see what will be painted, so the fence and the
    // quotes come off first or the re-emission hides behind them.
    it.each([
      ["a fenced reply", "```\ntest\n```"],
      ["a quoted reply", '"test"'],
      ["an invisible character between the two", "\x00test"],
    ])("finds the overlap in %s", (_description, suggestion) => {
      expect(sanitizeSuggestion(suggestion, "tes")).toBe("t");
    });
  });
});
