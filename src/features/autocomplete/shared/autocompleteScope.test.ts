import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDED_BUNDLE_IDS,
  decideAppScope,
  isAutocompleteScopeMode,
  isAutocompleteSurfaceKind,
  MAX_BUNDLE_ID_LENGTH,
  MAX_RAW_APP_LIST_ENTRIES,
  MAX_SCOPED_APPS,
  isUnusableAppList,
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

  /**
   * These previously asserted DROPPING and TRUNCATION as correct, which is what
   * let the fail-open through: for the exclusions, every entry that quietly
   * disappears is an app that quietly becomes readable. Re-seeding is the only
   * safe answer, because "I could not read your exclusions" must never resolve
   * to "you had none".
   */
  it.each([
    ["a non-string entry", ["com.apple.mail", 42]],
    ["a null entry", [null]],
    ["an empty-string entry", ["com.apple.mail", ""]],
    ["a whitespace-only entry", ["com.apple.mail", "   "]],
    ["an overlong entry", ["com.apple.mail", "x".repeat(500)]],
    ["a control character", ["com.apple.mail"]],
    ["a string instead of a list", "com.apple.mail"],
    ["an object instead of a list", { 0: "com.apple.mail" }],
  ])("re-seeds rather than silently dropping %s", (_description, raw) => {
    expect(normalizeExcludedApps(raw)).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
  });

  it("re-seeds an over-cap list instead of truncating a real exclusion out of it", () => {
    const overCap = [
      ...Array.from({ length: MAX_SCOPED_APPS }, (_v, i) => `com.example.app${i}`),
      "com.1password.1password",
    ];

    expect(normalizeExcludedApps(overCap)).toEqual([...DEFAULT_EXCLUDED_BUNDLE_IDS]);
  });

  it("keeps a list that exactly fills the cap — the bound is a limit, not a fault", () => {
    const exact = Array.from({ length: MAX_SCOPED_APPS }, (_v, i) => `com.example.app${i}`);

    expect(normalizeExcludedApps(exact)).toHaveLength(MAX_SCOPED_APPS);
  });

  /**
   * Both bounds must refuse EARLY, not after walking the whole input: this runs
   * on a store file, an import, and the IPC boundary, so the size of the answer
   * must not be set by the size of the attacker's array.
   *
   * Asserted by counting canonicalisations rather than by timing, which would be
   * a flaky proxy for the same thing.
   */
  it("refuses an over-long raw list without inspecting a single entry", () => {
    // Counting index reads, not elapsed time: a timing assertion would be a
    // flaky proxy for the same claim. All-duplicate on purpose — it collapses
    // to ONE distinct id, so the distinct cap can never refuse it and only the
    // raw bound can. That also makes this observable: before the raw bound
    // existed, this exact input normalized happily to `["com.apple.mail"]`.
    let reads = 0;
    const huge: unknown[] = new Array(MAX_RAW_APP_LIST_ENTRIES + 1);
    for (let index = 0; index < huge.length; index += 1) {
      Object.defineProperty(huge, index, {
        configurable: true,
        enumerable: true,
        get: () => {
          reads += 1;
          return "com.apple.mail";
        },
      });
    }

    expect(isUnusableAppList(huge)).toBe(true);
    expect(reads).toBe(0);
  });

  it("stops at the distinct cap instead of walking the rest of the list", () => {
    let reads = 0;
    const overDistinct: unknown[] = new Array(MAX_SCOPED_APPS + 500);
    for (let index = 0; index < overDistinct.length; index += 1) {
      Object.defineProperty(overDistinct, index, {
        configurable: true,
        enumerable: true,
        get: () => {
          reads += 1;
          return `com.example.app${index}`;
        },
      });
    }

    expect(isUnusableAppList(overDistinct)).toBe(true);
    expect(reads).toBe(MAX_SCOPED_APPS + 1);
  });

  // Duplicates collapse without losing meaning, so they must not read as
  // corruption — otherwise re-saving a list the UI itself produced re-seeds it.
  it("does not treat duplicates as corruption even when they exceed the cap", () => {
    const dupes = Array.from({ length: MAX_SCOPED_APPS + 50 }, () => "com.apple.mail");

    expect(normalizeExcludedApps(dupes)).toEqual(["com.apple.mail"]);
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
