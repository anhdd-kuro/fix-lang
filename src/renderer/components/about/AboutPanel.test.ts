/**
 * @file AboutPanel.test.ts
 * @description Renders the real About tab (via `react-dom/client` + `act`, the
 * technique used by `SettingUpdates.test.ts` / `OverviewPanel.test.ts` — no
 * `@testing-library/react` is installed) and drives the sub-tab bar.
 *
 * What it protects: both sub-tabs are reachable and only the active one renders
 * (a guide mounted behind the update controls would fire its IPC reads on every
 * About open), the guide reports the CONFIGURED shortcuts rather than the
 * built-in defaults, and its two affordances (Open settings, docs link) actually
 * do something. Expected copy comes from the real translator kernel, never
 * hand-restated English, so a catalog reword cannot silently pass.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { AboutPanel } from "./AboutPanel";
import { I18nProvider } from "../../i18n/I18nProvider";

const t = createTranslator("en");

const CONFIGURED_PRESETS = [
  { id: "correction", name: "Correction", hotkey: "Control+Shift+F" },
  // Deliberately hotkey-less: the guide must show its empty state, not a chip.
  { id: "custom", name: "Bug report polish", hotkey: "" },
];

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

type ApiOverrides = Partial<Record<string, unknown>>;

const buildApi = (overrides: ApiOverrides = {}) => ({
  // User guide reads
  getCorrectSettings: vi.fn().mockResolvedValue({
    presets: CONFIGURED_PRESETS,
    selectedPresetId: "correction",
  }),
  getKeyBindings: vi
    .fn()
    .mockResolvedValue({
      promptGen: "Control+Shift+G",
      profileSwitch: "Alt+P",
    }),
  getCorrectionOutputMode: vi.fn().mockResolvedValue("popup"),
  getProviderStates: vi.fn().mockResolvedValue({
    openai: { connected: true },
    openrouter: { connected: false },
  }),
  onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
  onActiveProfileChanged: vi.fn().mockReturnValue(vi.fn()),
  openExternalLink: vi.fn().mockResolvedValue({ success: true }),
  previewCorrectionResult: vi.fn().mockResolvedValue(undefined),
  // SettingUpdates reads
  getUpdateState: vi
    .fn()
    .mockResolvedValue({ phase: "idle", currentVersion: "0.8.5" }),
  onUpdateStateChanged: vi.fn().mockReturnValue(vi.fn()),
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  openUpdateRelease: vi.fn().mockResolvedValue(undefined),
  installUpdate: vi.fn().mockResolvedValue({ success: true }),
  restartForUpdate: vi.fn().mockResolvedValue({ success: true }),
  // I18nProvider reads these on mount.
  getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
  setLocale: vi.fn().mockResolvedValue({ success: true }),
  onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
  ...overrides,
});

describe("AboutPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onOpenSettings: ReturnType<typeof vi.fn>;
  let onNavigateToTab: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof buildApi>;

  const render = async (overrides: ApiOverrides = {}) => {
    api = buildApi(overrides);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });
    onOpenSettings = vi.fn();
    onNavigateToTab = vi.fn();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(AboutPanel, { onOpenSettings, onNavigateToTab }),
        ),
      );
    });
    // `<I18nProvider>` resolves its locale asynchronously before rendering
    // children, so the panel's own fetches need a tick beyond that one.
    await waitForUi();
    await waitForUi();
  };

  const tabs = (): HTMLButtonElement[] => [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ];

  const tabNamed = (label: string): HTMLButtonElement => {
    const tab = tabs().find((candidate) => candidate.textContent === label);
    if (!tab) {
      throw new Error(`Expected a sub-tab named ${label}`);
    }
    return tab;
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

  it("opens on App updates with the guide not mounted", async () => {
    await render();

    expect(tabs().map((tab) => tab.textContent)).toEqual([
      t("about.tab.updates"),
      t("about.tab.guide"),
    ]);
    expect(tabNamed(t("about.tab.updates")).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(container.textContent).toContain(t("settings.updates.title"));
    expect(container.textContent).not.toContain(t("guide.title"));
    // The guide's reads must not happen until the guide is opened.
    expect(api.getCorrectSettings).not.toHaveBeenCalled();
  });

  it("switches to the guide and swaps which panel renders", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    expect(tabNamed(t("about.tab.guide")).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(tabNamed(t("about.tab.updates")).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(container.textContent).toContain(t("guide.title"));
    expect(container.textContent).toContain(t("guide.setup.title"));
    expect(container.textContent).not.toContain(
      t("settings.updates.howToTitle"),
    );

    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel?.id).toBe("about-panel-guide");
    expect(panel?.getAttribute("aria-labelledby")).toBe("about-tab-guide");
  });

  it("switches back to the update controls", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();
    await click(tabNamed(t("about.tab.updates")));
    await waitForUi();

    expect(container.textContent).toContain(t("settings.updates.checkButton"));
    expect(container.textContent).not.toContain(t("guide.title"));
  });

  it("reports the configured shortcuts, output mode and connected providers", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    const text = container.textContent ?? "";
    expect(text).toContain("Bug report polish");
    expect(text).toContain(t("guide.presets.noHotkey"));
    // The live profile-switch binding, not the "Control+Shift+P" default.
    expect(text).toContain(
      t("guide.topic.profiles.body", { hotkey: "Alt + P" }),
    );
    expect(text).toContain(
      t("guide.output.current", {
        mode: t("settings.general.correctionOutput.popup.label"),
        description: t("settings.general.correctionOutput.popup.description"),
      }),
    );
    expect(text).toContain(
      t("guide.setup.provider.connected", {
        providers: t("settings.general.provider.openai"),
      }),
    );
    expect(text).not.toContain(t("guide.setup.provider.none"));

    const chips = [...container.querySelectorAll("li > ul > li")].map(
      (chip) => chip.textContent,
    );
    expect(chips).toContain("Control");
    expect(chips).toContain("Shift");
    expect(chips).toContain("F");
  });

  it("warns when no provider is connected", async () => {
    await render({ getProviderStates: vi.fn().mockResolvedValue({}) });
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    expect(container.textContent).toContain(t("guide.setup.provider.none"));
  });

  it("keeps the written guidance when the setup read fails", async () => {
    await render({
      getCorrectSettings: vi.fn().mockRejectedValue(new Error("ipc down")),
    });
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    expect(container.textContent).toContain(t("guide.loadError"));
    expect(container.textContent).toContain(t("guide.setup.provider.body"));
    // No invented "you have no presets" claim when reading them is what broke.
    expect(container.textContent).not.toContain(t("guide.presets.empty"));
  });

  it("offers an empty state when the profile has no presets", async () => {
    await render({
      getCorrectSettings: vi
        .fn()
        .mockResolvedValue({ presets: [], selectedPresetId: "" }),
    });
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    expect(container.textContent).toContain(t("guide.presets.empty"));
  });

  it("wires the guide's settings button and docs link", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    const settingsButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("guide.openSettings"),
    );
    expect(settingsButton).toBeDefined();
    await click(settingsButton as Element);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    const link = [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === t("guide.docsLink"),
    );
    expect(link).toBeDefined();
    await click(link as Element);
    // Only http/https survives main's validation, so the href must be one.
    expect(api.openExternalLink).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\//),
    );
  });

  it("uses the Import button style for the result example action", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    const exampleButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("guide.result.viewExample"),
    );
    expect(exampleButton).toBeDefined();
    expect(exampleButton?.classList).toContain("bg-secondary");
    expect(exampleButton?.classList).toContain("text-secondary-foreground");
    expect(exampleButton?.classList).toContain("font-medium");

    await click(exampleButton as Element);
    expect(api.previewCorrectionResult).toHaveBeenCalledTimes(1);
  });

  it("opens Settings on the right tab when a 'Settings worth knowing' title is clicked", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    const outputLink = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("guide.topic.output.title"),
    );
    expect(outputLink).toBeDefined();
    await click(outputLink as Element);
    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("general");

    const themeLink = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("guide.topic.theme.title"),
    );
    expect(themeLink).toBeDefined();
    await click(themeLink as Element);
    expect(onOpenSettings).toHaveBeenLastCalledWith("appearance");
  });

  it("switches the dashboard tab when a 'Where to look afterwards' title is clicked", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    const historyLink = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("dashboard.tab.history"),
    );
    expect(historyLink).toBeDefined();
    await click(historyLink as Element);
    expect(onNavigateToTab).toHaveBeenCalledExactlyOnceWith("history");
  });

  it("re-reads the guide when settings change or the profile switches", async () => {
    await render();
    await click(tabNamed(t("about.tab.guide")));
    await waitForUi();

    expect(api.onSettingsUpdated).toHaveBeenCalledTimes(1);
    expect(api.onActiveProfileChanged).toHaveBeenCalledTimes(1);

    const reload = api.onSettingsUpdated.mock.calls[0]?.[0] as () => void;
    api.getKeyBindings.mockResolvedValue({
      promptGen: "Control+Shift+G",
      profileSwitch: "Control+Alt+9",
    });
    await act(async () => {
      reload();
    });
    await waitForUi();

    expect(container.textContent).toContain(
      t("guide.topic.profiles.body", { hotkey: "Control + Alt + 9" }),
    );
  });
});
