import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDED_BUNDLE_IDS,
  decideAppScope,
  defaultScopeModeForProvider,
  isAutocompleteScopeMode,
  isAutocompleteSurfaceKind,
  MAX_BUNDLE_ID_LENGTH,
  MAX_SCOPED_APPS,
  normalizeBundleId,
  normalizeAllowedApps,
  normalizeExcludedApps,
  requiresCloudScopeConsent,
} from "./autocompleteScope";

describe("normalizeBundleId", () => {
  it("lower-cases, so a capital in a list entry cannot silently disarm it", () => {
    expect(normalizeBundleId("Com.Apple.Mail")).toBe("com.apple.mail");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeBundleId("  com.apple.mail \n")).toBe("com.apple.mail");
  });

  it("rejects a control character rather than stripping it onto a listed id", () => {
    expect(normalizeBundleId("com.apple\u0007.mail")).toBeNull();
  });

  it.each([
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", { id: "com.apple.mail" }],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["control characters only", "\u0001\u0002"],
  ])("rejects %s", (_description, raw) => {
    expect(normalizeBundleId(raw)).toBeNull();
  });

  it("rejects an over-long id rather than truncating it into a prefix match", () => {
    expect(normalizeBundleId("c".repeat(MAX_BUNDLE_ID_LENGTH + 1))).toBeNull();
    expect(normalizeBundleId("c".repeat(MAX_BUNDLE_ID_LENGTH))).not.toBeNull();
  });
});

describe("normalizeExcludedApps", () => {
  it("seeds the shipped exclusions for an absent list", () => {
    expect(normalizeExcludedApps(undefined)).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
  });

  it("leaves a cleared list cleared rather than reseeding it", () => {
    expect(normalizeExcludedApps([])).toEqual([]);
  });

  it("returns a fresh array, so a mutated result cannot corrupt later seeds", () => {
    normalizeExcludedApps(undefined).push("com.example.mutated");

    expect(normalizeExcludedApps(undefined)).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
  });

  it("normalizes and deduplicates entries", () => {
    expect(
      normalizeExcludedApps(["Com.Apple.Mail", "com.apple.mail", " com.apple.mail "]),
    ).toEqual(["com.apple.mail"]);
  });

  it("drops unusable entries without discarding the usable ones beside them", () => {
    expect(normalizeExcludedApps(["com.apple.mail", 42, null, "", "com.apple.notes"])).toEqual([
      "com.apple.mail",
      "com.apple.notes",
    ]);
  });

  it.each([
    ["a string", "com.apple.mail"],
    ["an object", { 0: "com.apple.mail" }],
  ])("reads %s as an empty list rather than seeding from junk", (_description, raw) => {
    expect(normalizeExcludedApps(raw)).toEqual([]);
  });

  it("caps the stored list length", () => {
    const huge = Array.from({ length: MAX_SCOPED_APPS + 50 }, (_v, i) => `com.example.app${i}`);

    expect(normalizeExcludedApps(huge)).toHaveLength(MAX_SCOPED_APPS);
  });
});

describe("decideAppScope", () => {
  const base = {
    scopeMode: "denylist" as const,
    allowedApps: [] as string[],
    excludedApps: [] as string[],
  };

  it("permits FixLang's own window without consulting the list", () => {
    expect(
      decideAppScope({
        surface: "own",
        bundleId: null,
        scopeMode: "allowlist",
        allowedApps: [],
        excludedApps: [],
      }),
    ).toEqual({ permitted: true });
  });

  it("refuses a system surface that reported no app", () => {
    expect(decideAppScope({ ...base, surface: "system", bundleId: null })).toEqual({
      permitted: false,
      reason: "app-unidentified",
    });
  });

  it("refuses a system surface whose reported app is unusable", () => {
    expect(decideAppScope({ ...base, surface: "system", bundleId: "   " })).toEqual({
      permitted: false,
      reason: "app-unidentified",
    });
  });

  it.each([
    ["denylist", "denylist" as const],
    ["allowlist", "allowlist" as const],
  ])("refuses an unreadable list in %s mode rather than throwing", (_description, scopeMode) => {
    expect(
      decideAppScope({
        surface: "system",
        bundleId: "com.apple.mail",
        scopeMode,
        allowedApps: undefined as unknown as readonly string[],
        excludedApps: [],
      }),
    ).toEqual({ permitted: false, reason: "scope-unreadable" });

    expect(
      decideAppScope({
        surface: "system",
        bundleId: "com.apple.mail",
        scopeMode,
        allowedApps: [],
        excludedApps: undefined as unknown as readonly string[],
      }),
    ).toEqual({ permitted: false, reason: "scope-unreadable" });
  });

  describe("allowlist mode", () => {
    it("permits an allowed app", () => {
      expect(
        decideAppScope({
          ...base,
          surface: "system",
          bundleId: "com.apple.mail",
          scopeMode: "allowlist",
          allowedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: true });
    });

    it("refuses an app that is not on the allow list", () => {
      expect(
        decideAppScope({
          ...base,
          surface: "system",
          bundleId: "com.apple.notes",
          scopeMode: "allowlist",
          allowedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: false, reason: "app-not-allowed" });
    });

    it("matches case-insensitively against a normalized list", () => {
      expect(
        decideAppScope({
          ...base,
          surface: "system",
          bundleId: "COM.APPLE.MAIL",
          scopeMode: "allowlist",
          allowedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: true });
    });

    it("refuses nothing by default, because the allow list starts empty", () => {
      expect(
        decideAppScope({ ...base, surface: "system", bundleId: "com.apple.mail", scopeMode: "allowlist" }),
      ).toEqual({ permitted: false, reason: "app-not-allowed" });
    });
  });

  describe("denylist mode", () => {
    it("permits an app that is not excluded", () => {
      expect(
        decideAppScope({
          ...base,
          surface: "system",
          bundleId: "com.apple.notes",
          scopeMode: "denylist",
          excludedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: true });
    });

    it("refuses an excluded app", () => {
      expect(
        decideAppScope({
          ...base,
          surface: "system",
          bundleId: "com.apple.mail",
          scopeMode: "denylist",
          excludedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: false, reason: "app-excluded" });
    });
  });

  /**
   * The bug this split exists for. One `scopedApps` list seeded with the
   * password managers reads as "run ONLY in 1Password" the moment the mode is
   * `allowlist` — and `allowlist` is the DEFAULT for an upgraded profile.
   */
  it.each([
    ["allowlist", "allowlist" as const],
    ["denylist", "denylist" as const],
  ])("refuses an excluded app in %s mode, not just denylist", (_description, scopeMode) => {
    expect(
      decideAppScope({
        surface: "system",
        bundleId: "com.1password.1password",
        scopeMode,
        // Allow-listed AND excluded: the exclusion has to win, or allow-listing
        // a password manager would make it readable.
        allowedApps: ["com.1password.1password"],
        excludedApps: ["com.1password.1password"],
      }),
    ).toEqual({ permitted: false, reason: "app-excluded" });
  });

  it("gives the two modes opposite answers for the same unlisted app", () => {
    const input = {
      surface: "system" as const,
      bundleId: "com.apple.mail",
      allowedApps: [],
      excludedApps: [],
    };

    expect(decideAppScope({ ...input, scopeMode: "denylist" }).permitted).toBe(true);
    expect(decideAppScope({ ...input, scopeMode: "allowlist" }).permitted).toBe(false);
  });
});

describe("normalizeAllowedApps", () => {
  it("seeds NOTHING for an absent list, because allowlist is the closed mode", () => {
    expect(normalizeAllowedApps(undefined)).toEqual([]);
  });

  it("normalizes and deduplicates entries like the exclusion list does", () => {
    expect(normalizeAllowedApps(["Com.Apple.Mail", " com.apple.mail "])).toEqual([
      "com.apple.mail",
    ]);
  });
});

describe("defaultScopeModeForProvider", () => {
  it("gives a local provider the zero-configuration denylist", () => {
    expect(defaultScopeModeForProvider(true)).toBe("denylist");
  });

  it("gives everything else the allowlist", () => {
    expect(defaultScopeModeForProvider(false)).toBe("allowlist");
  });
});

describe("requiresCloudScopeConsent", () => {
  const cloudEverywhere = {
    surface: "system" as const,
    destinationIsLoopback: false,
    providerId: "openai",
    cloudScopeConsent: "openai",
  };

  it("is satisfied when the consented provider is the one in use", () => {
    expect(requiresCloudScopeConsent(cloudEverywhere)).toBe(false);
  });

  it("re-gates when the provider changes under a stored consent", () => {
    expect(requiresCloudScopeConsent({ ...cloudEverywhere, providerId: "openrouter" })).toBe(true);
  });

  it("re-gates when nothing has been consented to", () => {
    expect(requiresCloudScopeConsent({ ...cloudEverywhere, cloudScopeConsent: "" })).toBe(true);
  });

  it("refuses an unidentifiable provider even against a stored consent", () => {
    expect(requiresCloudScopeConsent({ ...cloudEverywhere, providerId: null })).toBe(true);
  });

  it("does not apply to FixLang's own window", () => {
    expect(
      requiresCloudScopeConsent({ ...cloudEverywhere, surface: "own", cloudScopeConsent: "" }),
    ).toBe(false);
  });

  it("does not apply to a loopback destination", () => {
    expect(
      requiresCloudScopeConsent({
        ...cloudEverywhere,
        destinationIsLoopback: true,
        providerId: "ollama",
        cloudScopeConsent: "",
      }),
    ).toBe(false);
  });

  it("still gates when a scopeMode rides along, so the old allowlist exemption cannot return", () => {
    const withAllowlist = {
      ...cloudEverywhere,
      cloudScopeConsent: "",
      scopeMode: "allowlist" as const,
    };

    expect(requiresCloudScopeConsent(withAllowlist)).toBe(true);
  });
});

describe("closed-set predicates", () => {
  it.each([
    ["allowlist", true],
    ["denylist", true],
    ["everywhere", false],
    ["", false],
    [42, false],
    [null, false],
    [undefined, false],
  ])("isAutocompleteScopeMode(%j) === %s", (value, expected) => {
    expect(isAutocompleteScopeMode(value)).toBe(expected);
  });

  it.each([
    ["own", true],
    ["system", true],
    ["global", false],
    [42, false],
    [null, false],
  ])("isAutocompleteSurfaceKind(%j) === %s", (value, expected) => {
    expect(isAutocompleteSurfaceKind(value)).toBe(expected);
  });
});
