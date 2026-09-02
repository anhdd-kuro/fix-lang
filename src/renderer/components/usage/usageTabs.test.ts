import { describe, expect, it } from "vitest";
import { PROVIDER_ORDER } from "~/features/providers/shared/providers";
import {
  buildUsageBar,
  buildUsageSubTabs,
  isUsageProvider,
  resolveActiveUsageProvider,
  resolveActiveUsageSubTab,
  USAGE_PROVIDERS,
} from "./usageTabs";

const connected = (provisioningKeySet = false) => ({
  connected: true,
  provisioningKeySet,
});
const disconnected = { connected: false, provisioningKeySet: false };

describe("usage sub-tabs", () => {
  it("only treats the account-billed providers as usage-capable", () => {
    expect([...USAGE_PROVIDERS]).toEqual(["openai", "openrouter"]);
    expect(isUsageProvider("ollama")).toBe(false);
    expect(isUsageProvider("lmstudio")).toBe(false);
  });

  it("shows a sub-tab per connected usage provider, with no admin key required", () => {
    const tabs = buildUsageSubTabs({
      openai: connected(),
      openrouter: connected(),
    });

    expect(tabs.map((tab) => tab.provider)).toEqual(["openai", "openrouter"]);
    expect(tabs.every((tab) => tab.hasAdminKey === false)).toBe(true);
  });

  it("hides providers that are not connected", () => {
    const tabs = buildUsageSubTabs({
      openai: disconnected,
      openrouter: connected(),
    });

    expect(tabs.map((tab) => tab.provider)).toEqual(["openrouter"]);
  });

  it("never shows a local provider, even when connected", () => {
    const tabs = buildUsageSubTabs({
      ollama: connected(),
      lmstudio: connected(true),
      openrouter: connected(),
    });

    expect(tabs.map((tab) => tab.provider)).toEqual(["openrouter"]);
  });

  it("orders a keyed provider ahead of an unkeyed one, so the first panel has data", () => {
    const tabs = buildUsageSubTabs({
      openai: connected(false),
      openrouter: connected(true),
    });

    expect(tabs.map((tab) => tab.provider)).toEqual(["openrouter", "openai"]);
    expect(tabs.map((tab) => tab.hasAdminKey)).toEqual([true, false]);
  });

  it("falls back to PROVIDER_ORDER when both providers are equally keyed", () => {
    const both = buildUsageSubTabs({
      openai: connected(true),
      openrouter: connected(true),
    });
    const expected = PROVIDER_ORDER.filter((provider) =>
      USAGE_PROVIDERS.includes(provider),
    );

    expect(both.map((tab) => tab.provider)).toEqual(expected);
  });

  it("returns no tabs when nothing usage-capable is connected", () => {
    expect(buildUsageSubTabs({})).toEqual([]);
    expect(buildUsageSubTabs({ ollama: connected() })).toEqual([]);
  });

  it("keeps the user on their chosen provider across a reordering refresh", () => {
    const tabs = buildUsageSubTabs({
      openai: connected(true),
      openrouter: connected(),
    });

    expect(resolveActiveUsageProvider(tabs, "openrouter")).toBe("openrouter");
  });

  it("falls back to the first tab when the active provider disappears", () => {
    const tabs = buildUsageSubTabs({ openrouter: connected() });

    expect(resolveActiveUsageProvider(tabs, "openai")).toBe("openrouter");
    expect(resolveActiveUsageProvider([], "openai")).toBeNull();
  });
});

describe("usage sub-tab bar", () => {
  it("appends Autocomplete after every provider sub-tab", () => {
    const bar = buildUsageBar(
      buildUsageSubTabs({ openai: connected(), openrouter: connected() }),
    );

    expect(bar.map((tab) => tab.key)).toEqual([
      "openai",
      "openrouter",
      "autocomplete",
    ]);
    expect(bar.at(-1)?.labelKey).toBe("usage.subTab.autocomplete");
  });

  // Autocomplete reports what THIS app spent from local rollups, so it needs no
  // account at all. A user on Ollama alone has zero provider sub-tabs and would
  // otherwise have no way to reach it.
  it("still offers Autocomplete when no provider is connected", () => {
    const bar = buildUsageBar([]);

    expect(bar.map((tab) => tab.key)).toContain("autocomplete");
  });

  // The connect-a-provider card used to replace the whole Usage tab. With
  // another sub-tab beside it that guidance would vanish, so it keeps a slot —
  // and keeps being the one the user lands on.
  it("keeps the connect-a-provider slot first when nothing is connected", () => {
    const bar = buildUsageBar([]);

    expect(bar.map((tab) => tab.key)).toEqual(["providers", "autocomplete"]);
    expect(resolveActiveUsageSubTab(bar, null)).toBe("providers");
  });

  it("drops the empty slot as soon as a provider connects", () => {
    const bar = buildUsageBar(buildUsageSubTabs({ openai: connected() }));

    expect(bar.map((tab) => tab.key)).not.toContain("providers");
  });

  it("keeps the user on Autocomplete across a provider-state refresh", () => {
    const before = buildUsageBar(buildUsageSubTabs({ openai: connected() }));
    const after = buildUsageBar(
      buildUsageSubTabs({ openai: connected(), openrouter: connected() }),
    );

    expect(resolveActiveUsageSubTab(before, "autocomplete")).toBe("autocomplete");
    expect(resolveActiveUsageSubTab(after, "autocomplete")).toBe("autocomplete");
  });

  it("falls back to the first slot when the chosen one disappears", () => {
    const bar = buildUsageBar(buildUsageSubTabs({ openrouter: connected() }));

    expect(resolveActiveUsageSubTab(bar, "openai")).toBe("openrouter");
    expect(resolveActiveUsageSubTab([], "openai")).toBeNull();
  });
});
