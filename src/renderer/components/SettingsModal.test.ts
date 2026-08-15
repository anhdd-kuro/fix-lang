/**
 * @file SettingsModal.test.ts
 * @description Tab-table tests for the Settings modal, owning the guarantees
 * the Autocomplete card lost when it moved out of Settings → General into a
 * tab of its own: that the tab exists, that a user can reach it by clicking,
 * and that the panel behind it really carries the enable toggle and the model
 * picker.
 *
 * The negative half lives in `SettingGeneral.test.ts` ("no longer renders the
 * autocomplete card"), so the pair fails in one direction if the card
 * disappears altogether and in the other if a second copy is left behind.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders the real component via `react-dom/client`
 * + `act`, following `SettingGeneral.test.ts` / `AutocompletePanel.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { SettingsModal, settingsTabIndex, visibleSettingsTabIds } from "./SettingsModal";
import { I18nProvider } from "../i18n/I18nProvider";
import type { AutocompleteUsageSnapshot } from "~/features/autocomplete/shared/autocompleteWire";
import type { Locale } from "~/features/i18n/shared/registry";

// Expected copy is derived through the real translator kernel — never
// hand-written — so a catalog reword cannot silently break this file.
const tEn = createTranslator("en");

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const emptyRollup = () => ({
  date: "2026-08-07",
  requests: 0,
  responses: 0,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

const autocompleteUsage = (): AutocompleteUsageSnapshot => ({
  today: emptyRollup(),
  month: emptyRollup(),
  days: [],
  dailyCostCapUsd: 1500,
});

describe("SettingsModal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  const tabNamed = (label: string): HTMLButtonElement => {
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (candidate) => candidate.textContent === label,
    );
    if (!tab) {
      throw new Error(`Expected a settings tab named "${label}"`);
    }
    return tab;
  };

  const render = async () => {
    api = {
      // Profiles is tab 0, so `ProfileManager` mounts on every render.
      getProfiles: vi
        .fn()
        .mockResolvedValue({ profiles: [], currentProfileId: "" }),
      onProfileUpdated: vi.fn().mockReturnValue(vi.fn()),
      // `ProfileManager` embeds the profile-switch `HotkeyInput`.
      getKeyBindings: vi.fn().mockResolvedValue({}),
      pauseHotkeys: vi.fn().mockResolvedValue(undefined),
      resumeHotkeys: vi.fn().mockResolvedValue(undefined),
      // Read by `SettingAutocomplete` and its embedded `ModelSelect`.
      getAutocompleteSettings: vi
        .fn()
        .mockResolvedValue({ enabled: false, model: "" }),
      getAutocompleteUsage: vi.fn().mockResolvedValue(autocompleteUsage()),
      setAutocompleteSettings: vi.fn().mockResolvedValue({ success: true }),
      fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
      getProviderStates: vi.fn().mockResolvedValue({}),
      getSelectedModel: vi.fn().mockResolvedValue(""),
      setSelectedModel: vi.fn().mockResolvedValue({ success: true }),
      onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
      onActiveProfileChanged: vi.fn().mockReturnValue(vi.fn()),
      // `<I18nProvider>` reads these on mount (see `localeState.ts`).
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((_callback: (locale: Locale) => void) => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(SettingsModal, { isOpen: true, onClose: vi.fn() }),
        ),
      );
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves,
    // and the mounted panel's own fetches need a further tick.
    await waitForUi();
    await waitForUi();
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  it("lists Autocomplete as its own tab, in the per-feature run and before Appearance", () => {
    const ids = visibleSettingsTabIds();

    expect(ids).toContain("autocomplete");
    // Transform, Combos and Autocomplete are consecutive: all three are
    // per-feature areas, and Combos sits against Transform because a combo is
    // a chain of the presets edited there.
    expect(ids.indexOf("combos")).toBe(ids.indexOf("correction") + 1);
    expect(ids.indexOf("autocomplete")).toBe(ids.indexOf("combos") + 1);
    expect(ids.indexOf("autocomplete")).toBeLessThan(ids.indexOf("appearance"));
    expect(settingsTabIndex("autocomplete")).toBe(ids.indexOf("autocomplete"));
    expect(settingsTabIndex("combos")).toBe(ids.indexOf("combos"));
  });

  /**
   * The guard rails are configuration, so they live here rather than on the
   * dashboard — the dashboard's Security tab shows what the guards DID. A
   * regression that puts the controls back on the dashboard shows up as this
   * tab disappearing from the settings list.
   */
  it("lists Security in the per-feature run, after Autocomplete and before Appearance", () => {
    const ids = visibleSettingsTabIds();

    expect(ids).toContain("security");
    expect(ids.indexOf("security")).toBe(ids.indexOf("autocomplete") + 1);
    expect(ids.indexOf("security")).toBeLessThan(ids.indexOf("appearance"));
    expect(settingsTabIndex("security")).toBe(ids.indexOf("security"));
  });

  it("renders a Combos tab button that is reachable from another tab", async () => {
    await render();

    const tab = tabNamed(tEn("settings.modal.tabs.combos"));
    // Starts on Profiles, so the tab is genuinely somewhere else to go.
    expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(tab.getAttribute("aria-controls")).toBe("settings-combos");

    await click(tab);
    await waitForUi();

    expect(
      tabNamed(tEn("settings.modal.tabs.combos")).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelector('[role="tabpanel"]')?.getAttribute("id"),
    ).toBe("settings-combos");
  });

  it("renders an Autocomplete tab button that is reachable from another tab", async () => {
    await render();

    // `visibleSettingsTabIds()` and the JSX tab table are two lists that must
    // agree — the user guide resolves a tab id to an *index* through the
    // former and the user clicks the latter, so drift silently opens the
    // wrong tab.
    expect(
      [...container.querySelectorAll('[role="tab"]')].map((element) =>
        element.getAttribute("id"),
      ),
    ).toEqual(visibleSettingsTabIds().map((id) => `tab-${id}`));

    const tab = tabNamed(tEn("settings.modal.tabs.autocomplete"));
    // Starts on Profiles, so the tab is genuinely somewhere else to go.
    expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(tab.getAttribute("aria-controls")).toBe("settings-autocomplete");

    await click(tab);
    await waitForUi();

    expect(
      tabNamed(tEn("settings.modal.tabs.autocomplete")).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(
      container.querySelector('[role="tabpanel"]')?.getAttribute("id"),
    ).toBe("settings-autocomplete");
  });

  it("renders the autocomplete toggle and model picker inside that tab's panel", async () => {
    await render();

    await click(tabNamed(tEn("settings.modal.tabs.autocomplete")));
    // The card's own `getAutocompleteSettings`/`getAutocompleteUsage` pair
    // needs its own ticks before `isLoading` clears.
    await waitForUi();
    await waitForUi();

    const panel = container.querySelector("#settings-autocomplete");
    if (!panel) {
      throw new Error("Expected the autocomplete tab panel");
    }
    expect(panel.textContent).not.toContain(
      tEn("settings.autocomplete.loading"),
    );
    expect(
      [...panel.querySelectorAll("h2")].map((element) => element.textContent),
    ).toContain(tEn("settings.autocomplete.heading"));

    // The enable toggle: the real checkbox input, not just its label text.
    const toggleLabel = [...panel.querySelectorAll("label")].find(
      (candidate) =>
        candidate.textContent === tEn("settings.autocomplete.enabled.label"),
    );
    expect(toggleLabel?.querySelector('input[type="checkbox"]')).toBeTruthy();

    // The model picker: `ModelSelect` labels its control `#model-select`.
    expect(
      [...panel.querySelectorAll("label")].map((element) => element.textContent),
    ).toContain(tEn("settings.autocomplete.model.label"));
    expect(panel.querySelector("#model-select")).toBeTruthy();

    expect(panel.textContent).toContain(tEn("settings.autocomplete.privacy.typing"));
    expect(api.getAutocompleteSettings).toHaveBeenCalled();
    expect(api.getAutocompleteUsage).toHaveBeenCalled();
  });
});
