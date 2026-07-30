/**
 * @file userGuideView.test.ts
 * @description Covers the User guide's derivations, plus the invariant that
 * makes the guide trustworthy: every key it names exists in the EN catalog, and
 * every dashboard tab except About is described — a tab added without a
 * description would otherwise silently vanish from the guide.
 */
import { describe, expect, it } from "vitest";
import { EN_CATALOG } from "~/features/i18n/shared/locales";
import {
  buildDashboardRows,
  buildPresetRows,
  buildProviderRows,
  GUIDE_TOPICS,
  outputModeDescriptor,
  splitHotkey,
} from "./userGuideView";
import { DASHBOARD_TABS } from "../../MainWindow/dashboardTabs";

const catalogKeys = new Set(Object.keys(EN_CATALOG));

describe("splitHotkey", () => {
  it("splits a stored accelerator into press-order chips", () => {
    expect(splitHotkey("Control+Shift+F")).toEqual(["Control", "Shift", "F"]);
  });

  it("treats a cleared hotkey as no shortcut rather than an empty chip", () => {
    expect(splitHotkey("")).toEqual([]);
    expect(splitHotkey("   ")).toEqual([]);
    expect(splitHotkey(undefined)).toEqual([]);
    expect(splitHotkey("Control++F")).toEqual(["Control", "F"]);
  });
});

describe("buildPresetRows", () => {
  it("keeps configured order and splits each shortcut", () => {
    expect(
      buildPresetRows([
        { id: "a", name: "Correction", hotkey: "Control+Shift+F" },
        { id: "b", name: "Translate", hotkey: "" },
      ]),
    ).toEqual([
      { id: "a", name: "Correction", keys: ["Control", "Shift", "F"] },
      { id: "b", name: "Translate", keys: [] },
    ]);
  });

  it("returns nothing for an empty preset list (drives the empty state)", () => {
    expect(buildPresetRows([])).toEqual([]);
  });
});

describe("buildProviderRows", () => {
  it("lists only connected providers, in PROVIDER_ORDER", () => {
    expect(
      buildProviderRows({
        lmstudio: { connected: true },
        openai: { connected: true },
        openrouter: { connected: false },
      }).map((row) => row.provider),
    ).toEqual(["openai", "lmstudio"]);
  });

  it("returns nothing when no provider is connected", () => {
    expect(buildProviderRows({})).toEqual([]);
    expect(buildProviderRows({ openai: { connected: false } })).toEqual([]);
  });

  it("names only label keys the EN catalog defines", () => {
    const rows = buildProviderRows({
      openai: { connected: true },
      openrouter: { connected: true },
      ollama: { connected: true },
      lmstudio: { connected: true },
    });

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(catalogKeys).toContain(row.labelKey);
    }
  });
});

describe("outputModeDescriptor", () => {
  it("reuses the Settings radio's own strings for both modes", () => {
    expect(outputModeDescriptor("paste")).toEqual({
      labelKey: "settings.general.correctionOutput.paste.label",
      descriptionKey: "settings.general.correctionOutput.paste.description",
    });
    expect(outputModeDescriptor("popup")?.labelKey).toBe(
      "settings.general.correctionOutput.popup.label",
    );
  });

  it("has no descriptor for an unread mode (drives the unknown state)", () => {
    expect(outputModeDescriptor(null)).toBeNull();
  });

  it("names only keys the EN catalog defines", () => {
    for (const mode of ["paste", "popup"] as const) {
      const descriptor = outputModeDescriptor(mode);
      expect(catalogKeys).toContain(descriptor?.labelKey);
      expect(catalogKeys).toContain(descriptor?.descriptionKey);
    }
  });
});

describe("buildDashboardRows", () => {
  it("describes every dashboard tab except the one the reader is on", () => {
    expect(buildDashboardRows().map((row) => row.id)).toEqual(
      DASHBOARD_TABS.filter((tab) => tab.id !== "about").map((tab) => tab.id),
    );
  });

  it("reuses each tab's own label key, so a renamed tab renames itself here", () => {
    for (const row of buildDashboardRows()) {
      const tab = DASHBOARD_TABS.find((candidate) => candidate.id === row.id);
      expect(row.labelKey).toBe(tab?.labelKey);
      expect(catalogKeys).toContain(row.bodyKey);
    }
  });
});

describe("GUIDE_TOPICS", () => {
  it("has unique ids and only catalog-backed keys", () => {
    expect(new Set(GUIDE_TOPICS.map((topic) => topic.id)).size).toBe(
      GUIDE_TOPICS.length,
    );
    for (const topic of GUIDE_TOPICS) {
      expect(catalogKeys).toContain(topic.titleKey);
      expect(catalogKeys).toContain(topic.bodyKey);
    }
  });

  it("points every title at a real settings tab", () => {
    const validTabs = ["profiles", "general", "appearance", "correction", "promptGen"];
    for (const topic of GUIDE_TOPICS) {
      expect(validTabs).toContain(topic.settingsTab);
    }
  });

  it("marks exactly the bodies that interpolate a hotkey", () => {
    for (const topic of GUIDE_TOPICS) {
      const usesHotkey = EN_CATALOG[topic.bodyKey as keyof typeof EN_CATALOG]
        .toString()
        .includes("{hotkey}");
      expect(topic.interpolatesHotkey === true).toBe(usesHotkey);
    }
  });
});
