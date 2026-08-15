/**
 * @file SettingCombos.test.ts
 * @description DOM interaction tests for the Combos tab strip. Renders the
 * real component via `react-dom/client` + `act` (no `@testing-library/react`
 * is installed) — the same technique as `SettingSecurity.test.ts`.
 *
 * Focused on the tab/rename contract, which pure `comboEditorView` tests
 * cannot reach: the tablist must keep a selected, tabbable tab and a valid
 * `aria-labelledby` target while a name is being edited, and a rename ended
 * by keyboard must hand focus back rather than stranding it on `<body>`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingCombos } from "./SettingCombos";
import { I18nProvider } from "../i18n/I18nProvider";
import type { CorrectionSettings } from "~/features/providers/store/apiStore";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const correctionSettings = (): CorrectionSettings => ({
  selectedPresetId: "preset-1",
  presets: [
    {
      id: "preset-1",
      name: "Correction",
      hotkey: "",
      systemPrompt: "",
      model: "",
      isBuiltIn: true,
    },
  ],
  // Two steps each, so neither combo is invalid for reasons unrelated to
  // what these tests are about (the tab strip, not `validateCombo`).
  combos: [
    {
      id: "combo-a",
      name: "First combo",
      hotkey: "",
      steps: [
        { id: "step-1", presetId: "preset-1" },
        { id: "step-2", presetId: "preset-1" },
      ],
    },
    {
      id: "combo-b",
      name: "",
      hotkey: "",
      steps: [
        { id: "step-3", presetId: "preset-1" },
        { id: "step-4", presetId: "preset-1" },
      ],
    },
  ],
});

describe("SettingCombos tab strip", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getCorrectSettings: vi.fn().mockResolvedValue(correctionSettings()),
      setCorrectSettings: vi.fn().mockResolvedValue({ success: true }),
      getKeyBindings: vi.fn().mockResolvedValue({}),
      fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
      getSelectedModel: vi.fn().mockResolvedValue(""),
      onSettingsUpdated: vi.fn().mockReturnValue(() => undefined),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingCombos)),
      );
    });
    await waitForUi();
    await waitForUi();
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const tabs = (): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>('[role="tab"]'),
  ];

  const renameInput = (): HTMLInputElement | null =>
    container.querySelector<HTMLInputElement>('input[aria-label="Rename combo"]');

  const startRenamingFirstTab = async () => {
    await act(async () => {
      tabs()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    await waitForUi();
  };

  it("labels a named combo by its name and an unnamed one by its number", async () => {
    await render();

    const [named, unnamed] = tabs();
    expect(named.textContent).toBe("First combo");
    // `startsWith`, not equality: an unnamed combo also fails name validation,
    // so its tab carries the error marker asserted separately below.
    expect(unnamed.textContent?.startsWith("Combo 2")).toBe(true);
  });

  /** An invalid combo still blocks Save while its panel is unmounted, so its tab has to say so. */
  it("marks a tab whose combo has errors", async () => {
    await render();

    const [named, unnamed] = tabs();
    expect(named.textContent).not.toContain("Has errors");
    expect(unnamed.textContent).toContain("Has errors");
  });

  /**
   * The editor used to REPLACE its tab button, which left the tablist with no
   * selected tab and pointed the panel's `aria-labelledby` at a missing id.
   */
  it("keeps a selected, tabbable tab and a resolvable panel label while renaming", async () => {
    await render();
    await startRenamingFirstTab();

    expect(renameInput()).not.toBeNull();

    const selected = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected).not.toBeNull();
    expect(selected?.getAttribute("tabindex")).toBe("0");

    const panel = container.querySelector('[role="tabpanel"]');
    const labelledBy = panel?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy ?? ""}`)).not.toBeNull();
  });

  it("keeps the rename editor outside the tablist so arrows edit text, not tabs", async () => {
    await render();
    await startRenamingFirstTab();

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.contains(renameInput())).toBe(false);
  });

  it("returns focus to the tab after Enter commits the new name", async () => {
    await render();
    await startRenamingFirstTab();

    const input = renameInput();
    if (!input) throw new Error("Expected the rename input");
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "Renamed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await waitForUi();

    expect(renameInput()).toBeNull();
    expect(tabs()[0].textContent).toContain("Renamed");
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("returns focus to the tab after Escape reverts the rename", async () => {
    await render();
    await startRenamingFirstTab();

    const input = renameInput();
    if (!input) throw new Error("Expected the rename input");
    await act(async () => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await waitForUi();

    expect(renameInput()).toBeNull();
    expect(tabs()[0].textContent).toBe("First combo");
    expect(document.activeElement).toBe(tabs()[0]);
  });
});
