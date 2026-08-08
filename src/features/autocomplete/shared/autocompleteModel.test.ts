import { describe, expect, it } from "vitest";
import { resolveAutocompleteModelRef } from "./autocompleteModel";
import {
  DEFAULT_DAILY_COST_CAP_USD,
  MAX_DAILY_COST_CAP_USD,
  normalizeAutocompleteSettings,
} from "./autocompleteSettings";

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
  // Default-OFF is what keeps the feature off for an install that has never
  // seen it, with no migration pass and no configVersion bump — an existing
  // user must not be upgraded into a paid autocomplete provider they never
  // opted into.
  describe("enabled defaults to false", () => {
    it.each([
      ["undefined input", undefined],
      ["null input", null],
      ["an empty object", {}],
      ["a missing enabled key", { model: "openai::gpt-5" }],
      ["a non-boolean enabled", { enabled: "yes" }],
      ["a numeric enabled", { enabled: 0 }],
      ["a null enabled", { enabled: null }],
      ["a stored false", { enabled: false }],
    ])("reads %s as disabled", (_description, raw) => {
      expect(normalizeAutocompleteSettings(raw).enabled).toBe(false);
    });
  });

  // Only a stored literal `true` enables — otherwise a user who never opted
  // in would silently get the feature turned on for them.
  it("preserves a stored true", () => {
    expect(normalizeAutocompleteSettings({ enabled: true }).enabled).toBe(true);
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

  it("returns every field regardless of input shape", () => {
    expect(normalizeAutocompleteSettings("not an object at all")).toEqual({
      enabled: false,
      model: "",
      dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
    });
  });

  describe("dailyCostCapUsd", () => {
    it("defaults an absent cap rather than reading it as zero", () => {
      // Zero is a REAL setting ("spend nothing"), so a missing field must not
      // land on it — that would turn a feature the user enabled into one that
      // refuses every request, with nothing on screen to say why.
      expect(normalizeAutocompleteSettings({}).dailyCostCapUsd).toBe(
        DEFAULT_DAILY_COST_CAP_USD,
      );
    });

    it.each([undefined, null, "5", Number.NaN, Number.POSITIVE_INFINITY])(
      "falls back to the default for an unusable cap: %j",
      (dailyCostCapUsd) => {
        expect(
          normalizeAutocompleteSettings({ dailyCostCapUsd }).dailyCostCapUsd,
        ).toBe(DEFAULT_DAILY_COST_CAP_USD);
      },
    );

    it("keeps a stored cap inside the range", () => {
      expect(normalizeAutocompleteSettings({ dailyCostCapUsd: 2.5 }).dailyCostCapUsd).toBe(2.5);
      expect(normalizeAutocompleteSettings({ dailyCostCapUsd: 0 }).dailyCostCapUsd).toBe(0);
    });

    // Clamped, never rejected: `apiStore` runs `clearInvalidConfig: true`, so a
    // schema that refused an out-of-range cap would wipe every profile.
    it("clamps out-of-range caps instead of refusing them", () => {
      expect(normalizeAutocompleteSettings({ dailyCostCapUsd: -3 }).dailyCostCapUsd).toBe(0);
      expect(
        normalizeAutocompleteSettings({ dailyCostCapUsd: 5_000 }).dailyCostCapUsd,
      ).toBe(MAX_DAILY_COST_CAP_USD);
    });
  });
});
