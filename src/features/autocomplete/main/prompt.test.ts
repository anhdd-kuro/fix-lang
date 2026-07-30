import { describe, expect, it } from "vitest";
import {
  AUTOCOMPLETE_SYSTEM_PROMPT,
  buildAutocompletePrompt,
  PREFIX_WINDOW_CHARS,
  SUFFIX_WINDOW_CHARS,
} from "./prompt";

describe("buildAutocompletePrompt", () => {
  it("carries the prefix and the caret marker", () => {
    const { userPrompt } = buildAutocompletePrompt({ prefix: "Hello wor" });

    expect(userPrompt).toContain("Hello wor");
    expect(userPrompt).toContain("Continuation:");
  });

  it("omits the suffix section when the caret is at the end", () => {
    const { userPrompt } = buildAutocompletePrompt({ prefix: "Hello wor" });

    expect(userPrompt).not.toContain("Text after the caret");
  });

  it("includes the suffix section when there is text after the caret", () => {
    const { userPrompt } = buildAutocompletePrompt({
      prefix: "Hello ",
      suffix: " and goodbye",
    });

    expect(userPrompt).toContain("Text after the caret");
    expect(userPrompt).toContain(" and goodbye");
  });

  it("treats an empty suffix the same as no suffix", () => {
    expect(buildAutocompletePrompt({ prefix: "a", suffix: "" }).userPrompt).toBe(
      buildAutocompletePrompt({ prefix: "a" }).userPrompt,
    );
  });

  describe("windowing", () => {
    // The caret is the only position that matters, so truncation has to discard
    // the text FURTHEST from it: the prefix keeps its tail, the suffix its head.
    it("keeps the tail of an overlong prefix", () => {
      const prefix = `${"x".repeat(PREFIX_WINDOW_CHARS)}TAIL`;

      const { userPrompt } = buildAutocompletePrompt({ prefix });

      expect(userPrompt).toContain("TAIL");
      expect(userPrompt).not.toContain("x".repeat(PREFIX_WINDOW_CHARS));
    });

    it("keeps the head of an overlong suffix", () => {
      const suffix = `HEAD${"x".repeat(SUFFIX_WINDOW_CHARS)}`;

      const { userPrompt } = buildAutocompletePrompt({ prefix: "a", suffix });

      expect(userPrompt).toContain("HEAD");
      expect(userPrompt).not.toContain("x".repeat(SUFFIX_WINDOW_CHARS));
    });

    it("windows the prefix to exactly the configured size", () => {
      const prefix = "x".repeat(PREFIX_WINDOW_CHARS + 100);

      const { userPrompt } = buildAutocompletePrompt({ prefix });

      expect(userPrompt).toContain("x".repeat(PREFIX_WINDOW_CHARS));
      expect(userPrompt).not.toContain("x".repeat(PREFIX_WINDOW_CHARS + 1));
    });

    it("leaves a prefix shorter than the window untouched", () => {
      const { userPrompt } = buildAutocompletePrompt({ prefix: "short" });

      expect(userPrompt).toContain("short");
    });
  });

  // A trailing space decides whether the model continues the current word or
  // starts the next one, so the builder must not trim it away.
  it("preserves the prefix's trailing whitespace", () => {
    const { userPrompt } = buildAutocompletePrompt({ prefix: "Hello " });

    expect(userPrompt).toContain("Hello \n");
  });

  describe("system prompt", () => {
    it("is returned unchanged", () => {
      expect(buildAutocompletePrompt({ prefix: "a" }).systemPrompt).toBe(
        AUTOCOMPLETE_SYSTEM_PROMPT,
      );
    });

    // Each rule below exists because a chat-tuned model breaks ghost text
    // without it: the suggestion is inserted into a plain textarea verbatim.
    it.each([
      ["forbids repeating the given text", /[Nn]ever repeat/],
      ["forbids markdown and fences", /no markdown, no code fences/],
      ["forbids commentary", /no commentary/],
      ["allows continuing mid-word", /mid-word/],
      ["bounds the length", /at most one sentence/],
      ["allows an empty answer", /output nothing at all/],
    ])("%s", (_description, marker) => {
      expect(AUTOCOMPLETE_SYSTEM_PROMPT).toMatch(marker);
    });
  });
});
