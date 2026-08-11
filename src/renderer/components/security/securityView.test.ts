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
import { DEFAULT_SECRET_GUARD_SETTINGS } from "~/features/secretGuard/shared/secretGuardSettings";
import {
  resolveSecurityView,
  withDeniedBundleId,
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
