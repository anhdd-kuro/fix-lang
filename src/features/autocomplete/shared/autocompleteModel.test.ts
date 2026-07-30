import { describe, expect, it } from "vitest";
import { resolveAutocompleteModelRef } from "./autocompleteModel";
import { normalizeAutocompleteSettings } from "./autocompleteSettings";

describe("resolveAutocompleteModelRef", () => {
  it("prefers an explicitly stored ref", () => {
    expect(
      resolveAutocompleteModelRef("openai::gpt-4o-mini", "openai::gpt-5", "openai::gpt-4.1"),
    ).toBe("openai::gpt-4o-mini");
  });

  it("falls back to the Ask preset's ref when nothing is stored", () => {
    expect(resolveAutocompleteModelRef("", "openai::gpt-5", "openai::gpt-4.1")).toBe(
      "openai::gpt-5",
    );
  });

  // Ask's own model is commonly the inherit sentinel, so stopping at Ask would
  // resolve autocomplete to "" while a perfectly good global default exists.
  it("falls through to the global default when Ask itself inherits", () => {
    expect(resolveAutocompleteModelRef("", "", "openai::gpt-4.1")).toBe("openai::gpt-4.1");
  });

  it("returns the inherit sentinel when nothing is configured anywhere", () => {
    expect(resolveAutocompleteModelRef("", "", "")).toBe("");
  });

  describe("whitespace-only refs count as unset", () => {
    it.each([
      ["a padded stored ref", "   ", "openai::gpt-5", "", "openai::gpt-5"],
      ["a padded Ask ref", "", "  ", "openai::gpt-4.1", "openai::gpt-4.1"],
      ["every hop padded", " ", "  ", "   ", ""],
    ])("%s", (_description, stored, ask, global, expected) => {
      expect(resolveAutocompleteModelRef(stored, ask, global)).toBe(expected);
    });
  });

  it("trims a stored ref it does use", () => {
    expect(resolveAutocompleteModelRef("  openai::gpt-5  ", "", "")).toBe("openai::gpt-5");
  });
});

describe("normalizeAutocompleteSettings", () => {
  // Default-ON is what turns the feature on for an install that has never seen
  // it, with no migration pass and no configVersion bump.
  describe("enabled defaults to true", () => {
    it.each([
      ["undefined input", undefined],
      ["null input", null],
      ["an empty object", {}],
      ["a missing enabled key", { model: "openai::gpt-5" }],
      ["a non-boolean enabled", { enabled: "yes" }],
      ["a numeric enabled", { enabled: 0 }],
      ["a null enabled", { enabled: null }],
    ])("reads %s as enabled", (_description, raw) => {
      expect(normalizeAutocompleteSettings(raw).enabled).toBe(true);
    });
  });

  // Only a stored literal `false` disables — otherwise a user who turned the
  // feature off would silently get it back.
  it("preserves a stored false", () => {
    expect(normalizeAutocompleteSettings({ enabled: false }).enabled).toBe(false);
  });

  describe("model", () => {
    it("defaults to the inherit sentinel", () => {
      expect(normalizeAutocompleteSettings({}).model).toBe("");
    });

    it("keeps a stored ref", () => {
      expect(normalizeAutocompleteSettings({ model: "openai::gpt-5" }).model).toBe(
        "openai::gpt-5",
      );
    });

    it("trims a padded ref", () => {
      expect(normalizeAutocompleteSettings({ model: "  openai::gpt-5 " }).model).toBe(
        "openai::gpt-5",
      );
    });

    it.each([
      ["a number", 42],
      ["an object", { id: "x" }],
      ["null", null],
    ])("falls back to the sentinel for %s", (_description, model) => {
      expect(normalizeAutocompleteSettings({ model }).model).toBe("");
    });
  });

  it("returns both fields regardless of input shape", () => {
    expect(normalizeAutocompleteSettings("not an object at all")).toEqual({
      enabled: true,
      model: "",
    });
  });
});
