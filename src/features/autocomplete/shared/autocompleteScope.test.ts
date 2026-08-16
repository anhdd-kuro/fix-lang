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
  normalizeScopedApps,
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

describe("normalizeScopedApps", () => {
  it("seeds the shipped exclusions for an absent list", () => {
    expect(normalizeScopedApps(undefined)).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
  });

  it("leaves a cleared list cleared rather than reseeding it", () => {
    expect(normalizeScopedApps([])).toEqual([]);
  });

  it("returns a fresh array, so a mutated result cannot corrupt later seeds", () => {
    normalizeScopedApps(undefined).push("com.example.mutated");

    expect(normalizeScopedApps(undefined)).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
  });

  it("normalizes and deduplicates entries", () => {
    expect(
      normalizeScopedApps(["Com.Apple.Mail", "com.apple.mail", " com.apple.mail "]),
    ).toEqual(["com.apple.mail"]);
  });

  it("drops unusable entries without discarding the usable ones beside them", () => {
    expect(normalizeScopedApps(["com.apple.mail", 42, null, "", "com.apple.notes"])).toEqual([
      "com.apple.mail",
      "com.apple.notes",
    ]);
  });

  it.each([
    ["a string", "com.apple.mail"],
    ["an object", { 0: "com.apple.mail" }],
  ])("reads %s as an empty list rather than seeding from junk", (_description, raw) => {
    expect(normalizeScopedApps(raw)).toEqual([]);
  });

  it("caps the stored list length", () => {
    const huge = Array.from({ length: MAX_SCOPED_APPS + 50 }, (_v, i) => `com.example.app${i}`);

    expect(normalizeScopedApps(huge)).toHaveLength(MAX_SCOPED_APPS);
  });
});

describe("decideAppScope", () => {
  const base = { scopeMode: "denylist" as const, scopedApps: [] as string[] };

  it("permits FixLang's own window without consulting the list", () => {
    expect(
      decideAppScope({
        surface: "own",
        bundleId: null,
        scopeMode: "allowlist",
        scopedApps: [],
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
        scopedApps: undefined as unknown as readonly string[],
      }),
    ).toEqual({ permitted: false, reason: "scope-unreadable" });
  });

  describe("allowlist mode", () => {
    it("permits a listed app", () => {
      expect(
        decideAppScope({
          surface: "system",
          bundleId: "com.apple.mail",
          scopeMode: "allowlist",
          scopedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: true });
    });

    it("refuses an unlisted app", () => {
      expect(
        decideAppScope({
          surface: "system",
          bundleId: "com.apple.notes",
          scopeMode: "allowlist",
          scopedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: false, reason: "app-not-allowed" });
    });

    it("matches case-insensitively against a normalized list", () => {
      expect(
        decideAppScope({
          surface: "system",
          bundleId: "COM.APPLE.MAIL",
          scopeMode: "allowlist",
          scopedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: true });
    });
  });

  describe("denylist mode", () => {
    it("permits an unlisted app", () => {
      expect(
        decideAppScope({
          surface: "system",
          bundleId: "com.apple.notes",
          scopeMode: "denylist",
          scopedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: true });
    });

    it("refuses a listed app", () => {
      expect(
        decideAppScope({
          surface: "system",
          bundleId: "com.apple.mail",
          scopeMode: "denylist",
          scopedApps: ["com.apple.mail"],
        }),
      ).toEqual({ permitted: false, reason: "app-excluded" });
    });
  });

  it("gives the two modes opposite answers for the same input", () => {
    const input = { surface: "system" as const, bundleId: "com.apple.mail", scopedApps: [] };

    expect(decideAppScope({ ...input, scopeMode: "denylist" }).permitted).toBe(true);
    expect(decideAppScope({ ...input, scopeMode: "allowlist" }).permitted).toBe(false);
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
    isLocalProvider: false,
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

  it("does not apply to a local provider", () => {
    expect(
      requiresCloudScopeConsent({
        ...cloudEverywhere,
        isLocalProvider: true,
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
