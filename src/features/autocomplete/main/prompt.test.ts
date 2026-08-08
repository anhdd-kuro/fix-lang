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
    expect(userPrompt).toContain("JSON:");
  });

  /**
   * `Continuation:` is a PROSE cue, and the observed failure was a model
   * answering it with a sentence about why it could not continue. The trailing
   * label has to cue a brace instead.
   */
  it("does not end on a prose cue", () => {
    expect(buildAutocompletePrompt({ prefix: "Hello wor" }).userPrompt).not.toContain(
      "Continuation:",
    );
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
      ["states the JSON envelope", /\{"suggestion":/],
      ["names the one field the parser reads", /"suggestion" holds only the continuation/],
      ["forbids repeating the given text", /never any of the input text/],
      ["forbids markdown and fences", /No markdown, no code fences/],
      ["forbids commentary", /no commentary/],
      ["allows continuing mid-word", /mid-word/],
      ["bounds the length with a number", /never emit more than 15 words/],
      ["declines with an empty string rather than with prose", /\{"suggestion":""\}/],
    ])("%s", (_description, marker) => {
      expect(AUTOCOMPLETE_SYSTEM_PROMPT).toMatch(marker);
    });

    /**
     * THE PRIORITY, pinned as an ORDER rather than as two rules that happen to
     * both exist. A prompt listing the phrase case first invites the failure it
     * replaced: `ornith-1.0-9b`, given `tes`, answered ` is a common
     * abbreviation for test.` — it read a half-typed word as a finished thought
     * to comment on. The mid-word case has to be the first branch the model
     * reads, so a rewrite that keeps both rules but reverses them fails here.
     */
    it("puts the mid-word rule before the fall-back phrase rule", () => {
      const rules = AUTOCOMPLETE_SYSTEM_PROMPT.split("\n");
      const wordRuleIndex = rules.findIndex((line) => /^- Ends mid-word/.test(line));
      const phraseRuleIndex = rules.findIndex((line) => /^- Ends on a whole word/.test(line));

      expect(wordRuleIndex).toBeGreaterThanOrEqual(0);
      expect(phraseRuleIndex).toBeGreaterThan(wordRuleIndex);
    });

    /**
     * THE MISTAKE A WORD-COMPLETING MODEL MAKES, pinned by checking the example
     * is arithmetically right rather than merely present.
     *
     * A suggestion is APPENDED at the caret, so completing `tes` means `t`. The
     * "never repeat the input" rule already implies that, but re-emitting the
     * whole word is exactly what a model reaches for when the word is what it is
     * thinking of — so the prompt shows the fragment. The regex pulls the
     * example apart and re-derives it: the literal must parse, its suggestion
     * must NOT be the whole word, and typed + suggestion must BE the whole word.
     * Editing the example into `{"suggestion":"test"}` — the very output being
     * forbidden — turns it from a demonstration into an instruction to repeat,
     * and only re-deriving it catches that.
     */
    it("demonstrates appending at the caret, not re-emitting the word", () => {
      const example = /"(\w+)" -> (\{"suggestion":"[^"]*"\}), not "(\w+)"/.exec(
        AUTOCOMPLETE_SYSTEM_PROMPT,
      );
      if (!example) throw new Error("the mid-word rule must carry a literal example");

      const [, typed, literal, wholeWord] = example;
      const { suggestion } = JSON.parse(literal) as { suggestion: string };

      expect(suggestion).not.toBe(wholeWord);
      expect(typed + suggestion).toBe(wholeWord);
    });

    /**
     * THE AMBIGUOUS CASE, decided in the prompt rather than left to the model.
     *
     * `test` is a whole word and could also be the start of `testing`. Extending
     * it edits INSIDE a word the user had already finished, and a Tab aimed at
     * the sentence rewrites it; continuing past it appends beyond a boundary the
     * user has crossed, which typing on discards. So a whole word counts as
     * done, listed with the trailing space and the punctuation mark it behaves
     * like — dropping it from that list is what reopens the argument.
     */
    it("treats an already-complete word as done, like a space or a mark", () => {
      const phraseRule = AUTOCOMPLETE_SYSTEM_PROMPT.split("\n").find((line) =>
        /^- Ends on/.test(line),
      );

      expect(phraseRule).toMatch(/whole word/);
      expect(phraseRule).toMatch(/space/);
      expect(phraseRule).toMatch(/mark/);
    });

    /**
     * THE BUG, pinned at its source.
     *
     * The old prompt's last line was `If a sensible continuation is not obvious,
     * output nothing at all.` — an English sentence, and the last thing a model
     * that does not honour the system/user split sees. `ornith-1.0-9b` continued
     * it instead of obeying it and returned `nothing at all, as there is no
     * clear context or narrative to continue.` as the suggestion. The phrase and
     * anything like it must stay gone; the empty-string contract replaces it.
     */
    it.each([
      "output nothing at all",
      "nothing at all",
      "not obvious",
      "Output only",
    ])("no longer says %p", (banned) => {
      expect(AUTOCOMPLETE_SYSTEM_PROMPT).not.toContain(banned);
    });

    /**
     * The structural version of the same rule: the prompt must not END on a
     * sentence, because the end is where a continuation-shaped model picks up.
     * A closed JSON object has no grammatical continuation.
     *
     * Both ends are pinned, because the pair is what makes the whole thing read
     * as a schema rather than as a document to be continued: the SCHEMA line the
     * prompt opens on and the DECLINE value it closes on must each be a complete,
     * parseable JSON object carrying the one field the parser reads. An edit that
     * softens either into prose reopens the bug above — and prose is exactly what
     * a rewrite reaches for once the length rule has to live here.
     */
    const promptLines = (): string[] => AUTOCOMPLETE_SYSTEM_PROMPT.trimEnd().split("\n");
    const expectSuggestionObject = (literal: string): void => {
      expect(literal).toMatch(/^\{"suggestion":.*\}$/);
      expect(JSON.parse(literal)).toHaveProperty("suggestion");
    };

    /**
     * The schema is stated as an OBJECT ON ITS OWN LINE, at the top, before any
     * rule. Not merely "a brace appears somewhere": the position and the
     * line-alone-ness are the property, so an edit that describes the shape in
     * words and leaves the decline value as the only literal is a failure here
     * even though a brace still exists further down.
     */
    it("opens on the schema object, alone on its line, before the rules", () => {
      const lines = promptLines();
      const schemaIndex = lines.findIndex((line) => line.trimStart().startsWith("{"));

      expect(schemaIndex).toBeGreaterThanOrEqual(0);
      expect(schemaIndex).toBeLessThanOrEqual(1);
      expectSuggestionObject(lines[schemaIndex].trim());
    });

    it("closes on the decline object rather than on a sentence", () => {
      const lastLine = promptLines().at(-1) ?? "";

      expectSuggestionObject(lastLine.slice(lastLine.indexOf("{")));
    });

    /**
     * THE ONLY LENGTH CONTROL THERE IS, now that the request carries no
     * `maxOutputTokens` ceiling. A category ("brief", "one sentence") is judged
     * by the model and one sentence can run eighty words; a digit cannot be
     * reinterpreted. So the rule has to contain a number, and it has to be an
     * imperative rather than a description of a good suggestion.
     */
    it("states the length bound as an imperative carrying a digit", () => {
      const lengthRule = AUTOCOMPLETE_SYSTEM_PROMPT.split("\n").find((line) =>
        /words/.test(line),
      );

      expect(lengthRule).toBeDefined();
      expect(lengthRule).toMatch(/\d+ words/);
      expect(lengthRule).toMatch(/^- (Stop|Emit|Keep|Write|Never)/);
    });

    // Sent on every dispatch and used as the cacheable prefix, so it stays short.
    it("stays short enough to send on every keystroke", () => {
      expect(AUTOCOMPLETE_SYSTEM_PROMPT.length).toBeLessThan(500);
    });
  });
});
