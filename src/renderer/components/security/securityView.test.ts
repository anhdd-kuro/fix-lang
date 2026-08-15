/**
 * @file securityView.test.ts
 * @description Pure derivation tests for the Security dashboard tab. Mirrors
 * `autocompleteUsageView.test.ts` / `modelsView.test.ts`: every conditional
 * piece of copy comes back as a `StatusDescriptor` (a translation key plus
 * params), never an already-resolved string — a resolved string frozen into
 * component state would not update on a locale switch (see
 * `statusDescriptor.ts`).
 */
import { describe, expect, it } from "vitest";
import { EN_CATALOG } from "~/features/i18n/shared/locales";
import { DEFAULT_SECRET_GUARD_SETTINGS } from "~/features/secretGuard/shared/secretGuardSettings";
import {
  SECRET_GUARD_LIMITATION_KEYS,
  resolveSecurityView,
  withDeniedBundleId,
  withDeniedBundleIds,
  withoutDeniedBundleId,
} from "./securityView";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";

const guardSettings = (
  overrides: Partial<SelectionGuardSettings> = {},
): SelectionGuardSettings => ({
  clipboardMaxAgeSeconds: 5,
  maxSelectionChars: 20_000,
  deniedBundleIds: ["com.1password.1password"],
  ...overrides,
});

describe("resolveSecurityView", () => {
  it("never carries a resolved string — every message is a {key,params} descriptor", () => {
    const view = resolveSecurityView(guardSettings(), DEFAULT_SECRET_GUARD_SETTINGS, []);

    for (const descriptor of [
      view.clipboardAge.hint,
      view.selectionSize.hint,
      view.deniedApps.listHint,
      view.deniedApps.recentHint,
      view.secretGuard.maskHint,
    ]) {
      if (descriptor === null) continue;
      expect(descriptor.kind).toBe("plain");
      if (descriptor.kind === "plain") {
        expect(typeof descriptor.message.key).toBe("string");
      }
    }
  });

  it("shows the running description while the clipboard-age guard is enabled", () => {
    const view = resolveSecurityView(
      guardSettings({ clipboardMaxAgeSeconds: 5 }),
      DEFAULT_SECRET_GUARD_SETTINGS,
      [],
    );
    expect(view.clipboardAge.enabled).toBe(true);
    expect(view.clipboardAge.hint).toEqual({
      kind: "plain",
      message: { key: "security.clipboardAge.description" },
    });
  });

  it("shows the disabled hint when clipboardMaxAgeSeconds is 0", () => {
    const view = resolveSecurityView(
      guardSettings({ clipboardMaxAgeSeconds: 0 }),
      DEFAULT_SECRET_GUARD_SETTINGS,
      [],
    );
    expect(view.clipboardAge.enabled).toBe(false);
    expect(view.clipboardAge.hint).toEqual({
      kind: "plain",
      message: { key: "security.clipboardAge.disabledHint" },
    });
  });

  it("shows the running description while the size guard is enabled", () => {
    const view = resolveSecurityView(
      guardSettings({ maxSelectionChars: 20_000 }),
      DEFAULT_SECRET_GUARD_SETTINGS,
      [],
    );
    expect(view.selectionSize.enabled).toBe(true);
    expect(view.selectionSize.hint).toEqual({
      kind: "plain",
      message: { key: "security.selectionSize.description" },
    });
  });

  it("shows the disabled hint when maxSelectionChars is 0", () => {
    const view = resolveSecurityView(
      guardSettings({ maxSelectionChars: 0 }),
      DEFAULT_SECRET_GUARD_SETTINGS,
      [],
    );
    expect(view.selectionSize.enabled).toBe(false);
    expect(view.selectionSize.hint).toEqual({
      kind: "plain",
      message: { key: "security.selectionSize.disabledHint" },
    });
  });

  it("derives listHint only when the deny-list is empty", () => {
    expect(
      resolveSecurityView(guardSettings({ deniedBundleIds: [] }), DEFAULT_SECRET_GUARD_SETTINGS, [])
        .deniedApps.listHint,
    ).toEqual({ kind: "plain", message: { key: "security.deniedApps.empty" } });
    expect(
      resolveSecurityView(guardSettings(), DEFAULT_SECRET_GUARD_SETTINGS, []).deniedApps.listHint,
    ).toBeNull();
  });

  it("derives recentHint only when there are no recently used apps", () => {
    const withApps: ActiveApp[] = [{ name: "Slack", bundleId: "com.slack.slack" }];
    expect(
      resolveSecurityView(guardSettings(), DEFAULT_SECRET_GUARD_SETTINGS, []).deniedApps.recentHint,
    ).toEqual({ kind: "plain", message: { key: "security.deniedApps.recentEmpty" } });
    expect(
      resolveSecurityView(guardSettings(), DEFAULT_SECRET_GUARD_SETTINGS, withApps).deniedApps
        .recentHint,
    ).toBeNull();
  });

  it("uses isBundleIdDenied — case/whitespace-insensitive — to flag a recent app chip as blocked, not a raw includes()", () => {
    const recentApps: ActiveApp[] = [
      { name: "1Password", bundleId: " Com.1Password.1Password " },
      { name: "Slack", bundleId: "com.slack.slack" },
      { name: "Helper", bundleId: null },
    ];
    const view = resolveSecurityView(guardSettings(), DEFAULT_SECRET_GUARD_SETTINGS, recentApps);

    expect(view.deniedApps.recentApps).toEqual([
      { app: recentApps[0], blocked: true },
      { app: recentApps[1], blocked: false },
      { app: recentApps[2], blocked: false },
    ]);
  });

  it("only shows the mask hint in mask mode — confirm and off show no hint", () => {
    expect(
      resolveSecurityView(guardSettings(), { mode: "mask", highEntropyRule: false }, [])
        .secretGuard.maskHint,
    ).toEqual({ kind: "plain", message: { key: "security.secretGuard.maskHint" } });
    expect(
      resolveSecurityView(guardSettings(), { mode: "confirm", highEntropyRule: false }, [])
        .secretGuard.maskHint,
    ).toBeNull();
    expect(
      resolveSecurityView(guardSettings(), { mode: "off", highEntropyRule: false }, [])
        .secretGuard.maskHint,
    ).toBeNull();
  });

  it("passes mode and highEntropyRule through unchanged", () => {
    const view = resolveSecurityView(guardSettings(), { mode: "mask", highEntropyRule: true }, []);
    expect(view.secretGuard.mode).toBe("mask");
    expect(view.secretGuard.highEntropyRule).toBe(true);
  });
});

describe("withDeniedBundleId", () => {
  it("adds a normalized bundle id", () => {
    const next = withDeniedBundleId(guardSettings({ deniedBundleIds: [] }), " Com.Slack.Slack ");
    expect(next.deniedBundleIds).toEqual(["com.slack.slack"]);
  });

  it("is a no-op when the bundle id is already denied, case/whitespace-insensitively", () => {
    const settings = guardSettings({ deniedBundleIds: ["com.slack.slack"] });
    const next = withDeniedBundleId(settings, " COM.SLACK.SLACK ");
    expect(next).toEqual(settings);
  });

  it("is a no-op for an invalid bundle id", () => {
    const settings = guardSettings({ deniedBundleIds: [] });
    expect(withDeniedBundleId(settings, "   ")).toEqual(settings);
  });

  it("never mutates the settings passed in", () => {
    const settings = guardSettings({ deniedBundleIds: ["com.slack.slack"] });
    const before = JSON.stringify(settings);
    withDeniedBundleId(settings, "com.figma.desktop");
    expect(JSON.stringify(settings)).toBe(before);
  });
});

describe("withoutDeniedBundleId", () => {
  it("removes a bundle id, case/whitespace-insensitively", () => {
    const next = withoutDeniedBundleId(
      guardSettings({ deniedBundleIds: ["com.slack.slack", "com.figma.desktop"] }),
      " COM.SLACK.SLACK ",
    );
    expect(next.deniedBundleIds).toEqual(["com.figma.desktop"]);
  });

  it("is a no-op when the bundle id is not present", () => {
    const settings = guardSettings({ deniedBundleIds: ["com.figma.desktop"] });
    expect(withoutDeniedBundleId(settings, "com.slack.slack")).toEqual(settings);
  });

  it("never mutates the settings passed in", () => {
    const settings = guardSettings({ deniedBundleIds: ["com.slack.slack"] });
    const before = JSON.stringify(settings);
    withoutDeniedBundleId(settings, "com.slack.slack");
    expect(JSON.stringify(settings)).toBe(before);
  });
});

describe("withDeniedBundleIds", () => {
  it("adds every valid id in one step, normalized", () => {
    const next = withDeniedBundleIds(guardSettings({ deniedBundleIds: [] }), [
      " Com.Slack.Slack ",
      "com.figma.Desktop",
    ]);
    expect(next.deniedBundleIds).toEqual(["com.slack.slack", "com.figma.desktop"]);
  });

  it("adds a duplicate within the same batch only once", () => {
    const next = withDeniedBundleIds(guardSettings({ deniedBundleIds: [] }), [
      "com.slack.slack",
      "COM.SLACK.SLACK",
    ]);
    expect(next.deniedBundleIds).toEqual(["com.slack.slack"]);
  });

  /**
   * Reference identity is the caller's "nothing changed" signal — it is what
   * lets a drop of an already-blocked app skip the store write (and the
   * "Saved." flash that would otherwise claim something happened).
   */
  it("returns the SAME reference when every id was already denied", () => {
    const settings = guardSettings({ deniedBundleIds: ["com.slack.slack"] });
    expect(withDeniedBundleIds(settings, [" com.slack.slack "])).toBe(settings);
  });

  it("returns the SAME reference for an empty batch", () => {
    const settings = guardSettings();
    expect(withDeniedBundleIds(settings, [])).toBe(settings);
  });

  it("keeps the valid ids when the batch also holds an invalid one", () => {
    const next = withDeniedBundleIds(guardSettings({ deniedBundleIds: [] }), [
      "   ",
      "com.slack.slack",
    ]);
    expect(next.deniedBundleIds).toEqual(["com.slack.slack"]);
  });

  it("never mutates the settings passed in", () => {
    const settings = guardSettings({ deniedBundleIds: ["com.slack.slack"] });
    const before = JSON.stringify(settings);
    withDeniedBundleIds(settings, ["com.figma.desktop", "com.apple.notes"]);
    expect(JSON.stringify(settings)).toBe(before);
  });
});

describe("SECRET_GUARD_LIMITATION_KEYS", () => {
  it("resolves every point against the English catalog", () => {
    for (const key of SECRET_GUARD_LIMITATION_KEYS) {
      expect(EN_CATALOG[key as keyof typeof EN_CATALOG]).toBeTypeOf("string");
    }
  });

  /**
   * The copy was split out of one paragraph, and it is load-bearing — it once
   * shipped claiming masking meant "nothing is sent", which was false. Every
   * claim of the original has to survive the re-chunking, so the ones a
   * reword is most tempted to soften are pinned by content, not by count.
   */
  it("still makes every claim the single paragraph made", () => {
    const body = SECRET_GUARD_LIMITATION_KEYS.map(
      (key) => EN_CATALOG[key as keyof typeof EN_CATALOG],
    ).join(" ");

    expect(body).toContain("This is a pattern check, not a guarantee.");
    expect(body).toContain("will miss a secret that does not look like one");
    expect(body).toContain("sometimes flag things that are not secrets");
    expect(body).toContain("is never masked in part");
    expect(body).toContain("falls back to the confirm dialog");
    expect(body).toContain("It only checks text FixLang is about to send");
    expect(body).toContain("It cannot un-send.");
    expect(body).toContain("saved to your local history on this machine");
    expect(body).toContain("Inline autocomplete cannot ask you anything");
    expect(body).toContain("a credential you are part-way through typing");
  });
});
