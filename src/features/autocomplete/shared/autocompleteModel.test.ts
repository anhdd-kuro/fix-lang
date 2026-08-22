import { describe, expect, it } from "vitest";
import { resolveAutocompleteModelRef } from "./autocompleteModel";
import {
  DEFAULT_EXCLUDED_BUNDLE_IDS,
  MAX_SCOPED_APPS,
  decideAppScope,
} from "./autocompleteScope";
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
      scopeMode: "allowlist",
      allowedApps: [],
      excludedApps: [...DEFAULT_EXCLUDED_BUNDLE_IDS],
      cloudScopeConsent: "",
    });
  });

  describe("scope fields fail closed", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 42],
      ["an unknown mode", "everywhere"],
      ["an empty string", ""],
      ["an object", { mode: "denylist" }],
    ])("reads %s as allowlist, never denylist", (_description, scopeMode) => {
      expect(normalizeAutocompleteSettings({ scopeMode }).scopeMode).toBe("allowlist");
    });

    it("keeps a stored denylist", () => {
      expect(normalizeAutocompleteSettings({ scopeMode: "denylist" }).scopeMode).toBe("denylist");
    });

    it.each([
      ["a number", 42],
      ["null", null],
      ["an object", { provider: "openai" }],
    ])("reads %s as no consent at all", (_description, cloudScopeConsent) => {
      expect(normalizeAutocompleteSettings({ cloudScopeConsent }).cloudScopeConsent).toBe("");
    });

    it("trims a stored consent so a padded id cannot fail to match its provider", () => {
      expect(
        normalizeAutocompleteSettings({ cloudScopeConsent: "  openai " }).cloudScopeConsent,
      ).toBe("openai");
    });

    it("seeds an absent list but leaves a cleared one cleared", () => {
      expect(normalizeAutocompleteSettings({}).excludedApps).toEqual([
        ...DEFAULT_EXCLUDED_BUNDLE_IDS,
      ]);
      expect(
        normalizeAutocompleteSettings({ allowedApps: [], excludedApps: [] }).excludedApps,
      ).toEqual([]);
    });

    /**
     * Emptying just the corrupt field is the FAIL-OPEN answer, and was the bug:
     * an empty exclusion list under a surviving `denylist` permits every app.
     * `decideAppScope` cannot catch it either, because normalization runs first
     * and the junk is already gone by the time the gate looks.
     */
    it("closes the whole scope when a stored list is corrupt", () => {
      const settings = normalizeAutocompleteSettings({
        scopeMode: "denylist",
        allowedApps: [],
        excludedApps: "com.apple.mail",
      });

      expect(settings.scopeMode).toBe("allowlist");
      expect(settings.allowedApps).toEqual([]);
      expect(settings.excludedApps).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
    });

    it("closes on a corrupt allow list too, not only the exclusions", () => {
      const settings = normalizeAutocompleteSettings({
        scopeMode: "denylist",
        allowedApps: "com.apple.mail",
        excludedApps: [],
      });

      expect(settings.scopeMode).toBe("allowlist");
      expect(settings.allowedApps).toEqual([]);
    });

    it("leaves an absent list alone — absent is ordinary, not corruption", () => {
      const settings = normalizeAutocompleteSettings({ scopeMode: "denylist" });

      expect(settings.scopeMode).toBe("denylist");
      expect(settings.excludedApps).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
    });

    /**
     * Composed normalizer -> decision, because that composition is where the
     * fail-open lived and neither half shows it alone: the normalizer looks
     * merely lenient, the gate looks correct, and only together do they permit
     * a password manager. A well-formed array of junk is the case a shape-only
     * corruption check waves through.
     */
    describe("a list that survives its shape check but loses entries", () => {
      const permits = (raw: unknown, bundleId: string): boolean => {
        const settings = normalizeAutocompleteSettings(raw);
        return decideAppScope({
          surface: "system",
          bundleId,
          scopeMode: settings.scopeMode,
          allowedApps: settings.allowedApps,
          excludedApps: settings.excludedApps,
        }).permitted;
      };

      it.each([
        ["a null entry", [null]],
        ["a numeric entry", [42]],
        ["an empty-string entry", [""]],
        ["an overlong entry", ["x".repeat(500)]],
        ["a control character", ["com.apple.mail"]],
      ])("never permits an excluded app because of %s", (_description, excludedApps) => {
        expect(permits({ scopeMode: "denylist", allowedApps: [], excludedApps }, "com.1password.1password")).toBe(false);
      });

      // The subtlest one: every entry is valid and the list is well formed, but
      // a real exclusion sits past the cap and used to be truncated away.
      it("never permits an exclusion that was pushed past the cap", () => {
        const overCap = [
          ...Array.from({ length: MAX_SCOPED_APPS }, (_v, i) => `com.example.app${i}`),
          "com.1password.1password",
        ];

        expect(permits({ scopeMode: "denylist", allowedApps: [], excludedApps: overCap }, "com.1password.1password")).toBe(false);
      });
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
