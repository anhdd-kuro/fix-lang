import { describe, expect, it } from "vitest";
import { DASHBOARD_TABS } from "./dashboardTabs";

describe("Logs dashboard tab", () => {
  it("is exposed after OpenRouter, before Autocomplete and About", () => {
    expect(DASHBOARD_TABS.at(-3)).toEqual({ id: "logs", labelKey: "dashboard.tab.logs" });
    expect(DASHBOARD_TABS.at(-2)).toEqual({
      id: "autocomplete",
      labelKey: "dashboard.tab.autocomplete",
    });
    expect(DASHBOARD_TABS.at(-1)).toEqual({ id: "about", labelKey: "dashboard.tab.about" });
  });
});
