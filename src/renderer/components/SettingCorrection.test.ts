import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CORRECTION_PRESET_ID } from "~/prompts/correction";
import { createTranslator } from "~/shared/i18n/translate";
import { SettingCorrection } from "./SettingCorrection";
import { I18nProvider } from "../i18n/I18nProvider";

const tEn = createTranslator("en");

describe("SettingCorrection primary actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  it("uses the shared primary button for adding and saving presets", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            {
              id: DEFAULT_CORRECTION_PRESET_ID,
              name: "Correction",
              hotkey: "Control+Shift+F",
              systemPrompt: "Fix the text.",
              model: "",
              isBuiltIn: true,
            },
          ],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        getKeyBindings: vi.fn().mockResolvedValue({}),
        onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
        fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        getProviderStates: vi.fn().mockResolvedValue([]),
        getSelectedModel: vi.fn().mockResolvedValue(""),
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
      },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingCorrection)),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const buttons = [...container.querySelectorAll("button")];
    const add = buttons.find(
      (button) => button.textContent === tEn("settings.correction.addPreset"),
    );
    const save = buttons.find(
      (button) => button.textContent === tEn("settings.correction.savePresets"),
    );

    for (const button of [add, save]) {
      expect(button?.className).toContain("text-primary-foreground");
      expect(button?.className).toContain(
        "[&:where(:enabled:hover)]:bg-primary-hover",
      );
      expect(button?.className).toContain(
        "[&:where(:enabled:active)]:bg-primary-active",
      );
      expect(button?.className).toContain("focus-visible:ring-ring");
    }
    expect(add?.type).toBe("button");
    expect(save?.type).toBe("submit");
  });

  it("keeps selected and destructive preset controls on their shared variants", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            {
              id: DEFAULT_CORRECTION_PRESET_ID,
              name: "Correction",
              hotkey: "Control+Shift+F",
              systemPrompt: "Fix the text.",
              model: "",
              isBuiltIn: true,
            },
          ],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        getKeyBindings: vi.fn().mockResolvedValue({}),
        onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
        fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        getProviderStates: vi.fn().mockResolvedValue([]),
        getSelectedModel: vi.fn().mockResolvedValue(""),
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
      },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingCorrection)),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const selected = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Correction"),
    );
    const reset = [...container.querySelectorAll("button")].find(
      (button) =>
        button.textContent === tEn("settings.correction.resetBuiltIn"),
    );

    expect(selected?.type).toBe("button");
    expect(selected?.className).toContain("text-primary-foreground");
    expect(selected?.className).toContain(
      "[&:where(:enabled:hover)]:bg-primary-hover",
    );
    expect(selected?.querySelector(".text-foreground")).toBeNull();
    expect(selected?.querySelector(".text-muted-foreground")).toBeNull();
    expect(reset?.disabled).toBe(false);
    expect(reset?.className).toContain("bg-destructive");
    expect(reset?.className).toContain("text-destructive-foreground");
    expect(reset?.classList.contains("text-card-foreground")).toBe(false);
    expect(reset?.className).toContain(
      "[&:where(:enabled:hover)]:bg-destructive-hover",
    );
    expect(reset?.className).toContain(
      "[&:where(:enabled:active)]:bg-destructive-active",
    );
    expect(reset?.className).not.toMatch(
      /(?:^|\s)(?:enabled:)?(?:hover|active):bg-/,
    );

    const deleteButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === tEn("common.delete"),
    );
    expect(deleteButton?.className).toContain("text-destructive-foreground");
    expect(deleteButton?.classList.contains("text-destructive")).toBe(false);
    expect(deleteButton?.className).toContain(
      "[&:where(:enabled:hover)]:bg-destructive-hover",
    );
    expect(deleteButton?.className).toContain(
      "[&:where(:enabled:active)]:bg-destructive-active",
    );
    expect(deleteButton?.className).not.toMatch(
      /(?:^|\s)(?:enabled:)?(?:hover|active):bg-/,
    );
  });
});
