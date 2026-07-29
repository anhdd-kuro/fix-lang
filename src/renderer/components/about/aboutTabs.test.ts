/**
 * @file aboutTabs.test.ts
 * @description Covers the About tab's sub-tab table and its fallback rule.
 * The label keys are asserted against the real EN catalog: `t()` is typed, but
 * `MessageKey` is wide enough that a table entry naming a key no catalog
 * defines would still compile and only surface as a raw key in the tab bar.
 */
import { describe, expect, it } from "vitest";
import { EN_CATALOG } from "~/shared/i18n/locales";
import {
  ABOUT_TABS,
  DEFAULT_ABOUT_TAB_ID,
  isAboutTabId,
  resolveActiveAboutTab,
} from "./aboutTabs";

describe("ABOUT_TABS", () => {
  it("holds exactly the update and guide sub-tabs, updates first", () => {
    expect(ABOUT_TABS.map((tab) => tab.id)).toEqual(["updates", "guide"]);
  });

  it("defaults to the tab the tray's update button expects", () => {
    expect(DEFAULT_ABOUT_TAB_ID).toBe("updates");
    expect(ABOUT_TABS[0]?.id).toBe(DEFAULT_ABOUT_TAB_ID);
  });

  it("names only label keys the EN catalog defines", () => {
    for (const tab of ABOUT_TABS) {
      expect(Object.keys(EN_CATALOG)).toContain(tab.labelKey);
    }
  });
});

describe("isAboutTabId", () => {
  it("accepts live ids and rejects everything else", () => {
    expect(isAboutTabId("updates")).toBe(true);
    expect(isAboutTabId("guide")).toBe(true);
    expect(isAboutTabId("about")).toBe(false);
    expect(isAboutTabId(null)).toBe(false);
    expect(isAboutTabId(undefined)).toBe(false);
    expect(isAboutTabId(0)).toBe(false);
  });
});

describe("resolveActiveAboutTab", () => {
  it("keeps a live id", () => {
    expect(resolveActiveAboutTab("guide")).toBe("guide");
    expect(resolveActiveAboutTab("updates")).toBe("updates");
  });

  it("falls back to the default rather than rendering no panel", () => {
    expect(resolveActiveAboutTab(null)).toBe("updates");
    expect(resolveActiveAboutTab("renamed-tab")).toBe("updates");
  });
});
