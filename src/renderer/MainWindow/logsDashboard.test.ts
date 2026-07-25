import { describe, expect, it } from "vitest";
import { DASHBOARD_TABS } from "./dashboardTabs";

describe("Logs dashboard tab", () => {
  it("is exposed after OpenRouter, before About", () => {
    expect(DASHBOARD_TABS.at(-2)).toEqual({ id: "logs", label: "Logs" });
    expect(DASHBOARD_TABS.at(-1)).toEqual({ id: "about", label: "About" });
  });
});
