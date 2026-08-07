import { describe, expect, it } from "vitest";
import { parseAutocompleteReply } from "./parseReply";
import { MAX_SUGGESTION_CHARS, sanitizeSuggestion } from "./sanitize";

/** The pipeline as `service.ts` runs it: parse the envelope, then sanitize. */
const suggestionFor = (raw: unknown): string | null => {
  const parsed = parseAutocompleteReply(raw);
  return parsed.ok ? sanitizeSuggestion(parsed.suggestion) : null;
};

describe("parseAutocompleteReply", () => {
  it("reads the suggestion out of a well-formed reply", () => {
    expect(parseAutocompleteReply('{"suggestion":" over the lazy dog."}')).toEqual({
      ok: true,
      suggestion: " over the lazy dog.",
    });
  });

  it("accepts the pretty-printed form a model may emit", () => {
    expect(parseAutocompleteReply('{\n  "suggestion": " over the lazy dog."\n}')).toEqual({
      ok: true,
      suggestion: " over the lazy dog.",
    });
  });

  /**
   * The contract's own way of declining, and the whole reason the prompt no
   * longer contains an English sentence about outputting nothing.
   */
  it("accepts an empty string as the answer, and it is still an answer", () => {
    expect(parseAutocompleteReply('{"suggestion":""}')).toEqual({ ok: true, suggestion: "" });
  });

  it("ignores fields it was not asked for", () => {
    expect(parseAutocompleteReply('{"suggestion":" tail","confidence":0.9}')).toEqual({
      ok: true,
      suggestion: " tail",
    });
  });

  it("tolerates whitespace around the object", () => {
    expect(parseAutocompleteReply('  \n{"suggestion":" tail"}\n  ')).toEqual({
      ok: true,
      suggestion: " tail",
    });
  });

  /**
   * The ONE accommodation, and it is for packaging rather than for content:
   * chat-tuned models fence JSON reflexively, which is not the model disagreeing
   * about the contract.
   */
  describe("a fenced reply", () => {
    it.each([
      ["with a language tag", '```json\n{"suggestion":" tail"}\n```'],
      ["with no language tag", '```\n{"suggestion":" tail"}\n```'],
      ["with padding inside the fence", '```json\n\n  {"suggestion":" tail"}  \n\n```'],
    ])("is unwrapped %s", (_description, raw) => {
      expect(parseAutocompleteReply(raw)).toEqual({ ok: true, suggestion: " tail" });
    });
  });

  /**
   * THE REGRESSION THIS ENTIRE CHANGE EXISTS TO PREVENT.
   *
   * Both strings are verbatim from the running app: `ornith-1.0-9b` via LM
   * Studio, at a 3-character prefix, returned each of them AS THE SUGGESTION —
   * the model continuing the old prompt's closing instruction ("If a sensible
   * continuation is not obvious, output nothing at all.") as prose rather than
   * obeying it. Each rendered as ghost text, one Tab press from being inserted
   * into the user's question.
   *
   * They are pinned literally rather than paraphrased: a paraphrase would let
   * the exact observed failure drift out of the suite while the test still
   * passed on a sentence nobody ever saw.
   */
  describe("the refusal prose that caused this", () => {
    const REAL_REFUSALS = [
      'Nothing to continue here as the input text "tes" appears to be an incomplete word or fragment without clear context for further',
      "nothing at all, as there is no clear context or narrative to continue.",
    ] as const;

    it.each(REAL_REFUSALS)("refuses to parse %s", (refusal) => {
      expect(parseAutocompleteReply(refusal)).toEqual({ ok: false });
    });

    it.each(REAL_REFUSALS)("yields no suggestion at all for %s", (refusal) => {
      expect(suggestionFor(refusal)).toBeNull();
    });
  });

  describe("anything that is not the contract yields nothing", () => {
    it.each([
      // A JSON envelope cut off mid-string is what a provider's own output limit
      // does to a model that would not stop, and a partial suggestion is worse
      // than none: it would be inserted verbatim on Tab.
      ["a truncated envelope", '{"suggestion":" over the lazy do'],
      ["an envelope missing its closing brace", '{"suggestion":" over the lazy dog."'],
      ["a truncated fenced envelope", '```json\n{"suggestion":" over the la'],
      ["prose before the object", 'Sure! {"suggestion":" tail"}'],
      ["prose after the object", '{"suggestion":" tail"} Hope that helps!'],
      ["single-quoted JSON", "{'suggestion':' tail'}"],
      ["an unquoted key", '{suggestion:" tail"}'],
      ["a trailing comma", '{"suggestion":" tail",}'],
      ["a bare JSON string", '" over the lazy dog."'],
      ["a JSON array", '[{"suggestion":" tail"}]'],
      ["JSON null", "null"],
      ["an empty object", "{}"],
      ["an empty string", ""],
      ["whitespace only", "   \n  "],
      ["an empty fence", "```\n```"],
      ["a non-string reply", 42],
      ["an absent reply", undefined],
    ])("refuses %s", (_description, raw) => {
      expect(parseAutocompleteReply(raw)).toEqual({ ok: false });
      expect(suggestionFor(raw)).toBeNull();
    });

    /** A suggestion is a string. Nothing else is, however well-formed the JSON. */
    it.each([
      ["a number", '{"suggestion":42}'],
      ["an object", '{"suggestion":{"text":" tail"}}'],
      ["an array", '{"suggestion":[" tail"]}'],
      ["null", '{"suggestion":null}'],
      ["a boolean", '{"suggestion":true}'],
      ["a missing field", '{"completion":" tail"}'],
    ])("refuses a non-string suggestion field: %s", (_description, raw) => {
      expect(parseAutocompleteReply(raw)).toEqual({ ok: false });
      expect(suggestionFor(raw)).toBeNull();
    });
  });

  /**
   * An empty string is an ANSWER at the parse layer and NOTHING at the render
   * layer. Both halves matter: the first keeps a well-behaved model out of the
   * `unparseable-reply` warn, the second keeps an empty ghost — and the Tab
   * affordance riding on it — off the screen.
   */
  it("turns the empty-string answer into no suggestion downstream", () => {
    expect(suggestionFor('{"suggestion":""}')).toBeNull();
    expect(suggestionFor('{"suggestion":"   "}')).toBeNull();
  });

  /**
   * A JSON string proves well-formed JSON and nothing else. These arrive in the
   * raw reply as ordinary escape text and decode into content `sanitizeSuggestion`
   * exists to remove, which is why the parse cannot be the last step.
   */
  describe("what survives the parse still has to be sanitized", () => {
    it("strips control characters smuggled through a unicode escape", () => {
      expect(suggestionFor('{"suggestion":"safe\\u0000\\u0007text"}')).toBe("safetext");
    });

    it("strips a carriage return that would become a phantom line break", () => {
      expect(suggestionFor('{"suggestion":"one\\r\\ntwo"}')).toBe("one\ntwo");
    });

    /**
     * The user named embedded images specifically. Ghost text paints through a
     * plain mirror span today, so this never renders — the guarantee is that it
     * cannot start to, and that a Tab press inserts prose rather than markup
     * pointing at a URL the model chose.
     */
    it("strips markdown image syntax", () => {
      expect(suggestionFor('{"suggestion":" and here ![alt](https://example.com/x.png) it is"}')).toBe(
        " and here  it is",
      );
    });

    it("yields nothing when the suggestion was only an image", () => {
      expect(suggestionFor('{"suggestion":"![](https://example.com/x.png)"}')).toBeNull();
    });
  });

  /**
   * THE CASE THE REMOVED OUTPUT CEILING CREATED. The request no longer carries
   * `maxOutputTokens`, so a model that ignores "never emit more than 15 words"
   * can return a VALID envelope wrapping an essay — valid is the hard half, since
   * anything malformed was already refused above.
   *
   * That reply is not rejected: it parsed, so the model honoured the contract and
   * merely disobeyed the length request, and refusing it would spend the request
   * and show nothing. It is CUT instead, by `MAX_SUGGESTION_CHARS` — which is now
   * the only bound on how much of a reply can reach a ghost span in a small input
   * window. Pinned at both ends: the cut happens, and the part that survives is
   * the head, because ghost text continues from the caret.
   */
  it("cuts a valid but overlong suggestion instead of refusing it", () => {
    const essay = Array.from({ length: 200 }, () => "continuation").join("-");

    const suggestion = suggestionFor(JSON.stringify({ suggestion: essay }));

    expect(suggestion).not.toBeNull();
    expect(suggestion).toHaveLength(MAX_SUGGESTION_CHARS);
    expect(essay.startsWith(suggestion ?? "")).toBe(true);
  });

  // The clamp is on the DECODED string, so escapes cannot smuggle length past it
  // the way they smuggle control characters past the parse: 300 two-character
  // escapes are 600 characters of reply and 300 characters of suggestion.
  it("measures the cut after JSON unescaping, not on the raw reply", () => {
    const escaped = "\\\\".repeat(300);

    expect(suggestionFor(`{"suggestion":"${escaped}"}`)).toHaveLength(MAX_SUGGESTION_CHARS);
  });
});
