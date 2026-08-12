/**
 * @file OutputModeTabs.test.ts
 * @description Behaviour of the tray/settings output-mode segmented control.
 *
 * Vitest only collects `.test.ts` and `@testing-library/react` is not
 * installed, so the component is driven with `react-dom/client` + `act`,
 * matching `LanguageTabs.test.ts`.
 *
 * Expected copy is derived through the real translator kernel — never
 * hand-restated — so a catalog reword can't silently pass this file.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import { OutputModeTabs } from "./OutputModeTabs";
import { I18nProvider } from "../i18n/I18nProvider";
import type { CorrectionOutputMode } from "~/features/correction/shared/outputMode";

const t = createTranslator("en");

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

const buttons = (container: HTMLElement): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll("button"));

const group = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector<HTMLElement>('[role="group"]');
  if (!el) throw new Error("no role=group container rendered");
  return el;
};

describe("OutputModeTabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  let setCorrectionOutputMode: ReturnType<typeof vi.fn>;

  const mount = async (initialMode: CorrectionOutputMode) => {
    setCorrectionOutputMode = vi
      .fn()
      .mockResolvedValue({ success: true, mode: "popup" });

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getCorrectionOutputMode: vi.fn().mockResolvedValue(initialMode),
      setCorrectionOutputMode,
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
    };

    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(OutputModeTabs)),
      );
    });
    await waitForUi();
    await waitForUi();
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("loads the stored mode and marks it as pressed", async () => {
    await mount("popup");

    const pressed = buttons(container)
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);

    expect(pressed).toEqual([t("settings.general.correctionOutput.popup.label")]);
  });

  it("saves the mode when an inactive option is clicked", async () => {
    await mount("paste");

    const popup = buttons(container).find(
      (b) => b.textContent === t("settings.general.correctionOutput.popup.label"),
    );
    if (!popup) throw new Error("popup button not rendered");
    await click(popup);

    expect(setCorrectionOutputMode).toHaveBeenCalledExactlyOnceWith("popup");
    expect(popup.getAttribute("aria-pressed")).toBe("true");
  });

  it("does not re-request the mode already active", async () => {
    await mount("paste");

    const paste = buttons(container).find(
      (b) => b.textContent === t("settings.general.correctionOutput.paste.label"),
    );
    if (!paste) throw new Error("paste button not rendered");
    await click(paste);

    expect(setCorrectionOutputMode).not.toHaveBeenCalled();
  });

  it("reverts the highlight when the save is rejected", async () => {
    await mount("paste");
    setCorrectionOutputMode.mockResolvedValueOnce({ success: false });

    const popup = buttons(container).find(
      (b) => b.textContent === t("settings.general.correctionOutput.popup.label"),
    );
    if (!popup) throw new Error("popup button not rendered");
    await click(popup);
    await waitForUi();

    expect(popup.getAttribute("aria-pressed")).toBe("false");
  });


  it("shows save status in settings mode when persistence fails", async () => {
    await mount("paste");
    setCorrectionOutputMode.mockResolvedValueOnce({ success: false });

    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(OutputModeTabs, { showSaveStatus: true }),
        ),
      );
    });
    await waitForUi();
    await waitForUi();

    const popup = buttons(container).find(
      (b) => b.textContent === t("settings.general.correctionOutput.popup.label"),
    );
    if (!popup) throw new Error("popup button not rendered");
    await click(popup);
    await waitForUi();

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      t("settings.general.error", { message: t("settings.general.outputMode.saveFailed") }),
    );
  });

  it("shows unavailable status in settings mode when the bridge is missing on load", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
    };

    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(OutputModeTabs, { showSaveStatus: true }),
        ),
      );
    });
    await waitForUi();
    await waitForUi();

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      t("settings.general.error", {
        message: t("settings.general.outputMode.unavailable"),
      }),
    );
  });


  it("keeps failure status when a success clear timer would have fired", async () => {
    vi.useFakeTimers();
    try {
      await mount("paste");

      await act(async () => {
        root.render(
          createElement(
            I18nProvider,
            null,
            createElement(OutputModeTabs, { showSaveStatus: true }),
          ),
        );
      });
      await waitForUi();
      await waitForUi();

      setCorrectionOutputMode
        .mockResolvedValueOnce({ success: true, mode: "popup" })
        .mockResolvedValueOnce({ success: false });

      const popup = buttons(container).find(
        (b) => b.textContent === t("settings.general.correctionOutput.popup.label"),
      );
      const paste = buttons(container).find(
        (b) => b.textContent === t("settings.general.correctionOutput.paste.label"),
      );
      if (!popup || !paste) throw new Error("output mode buttons not rendered");

      await click(popup);
      await waitForUi();

      await click(paste);
      await waitForUi();

      const status = container.querySelector('[role="status"]');
      expect(status?.textContent).toContain(
        t("settings.general.error", { message: t("settings.general.outputMode.saveFailed") }),
      );

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(status?.textContent).toContain(
        t("settings.general.error", { message: t("settings.general.outputMode.saveFailed") }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("translates its accessible name", async () => {
    await mount("paste");
    expect(group(container).getAttribute("aria-label")).toBe(
      t("settings.general.correctionOutput.title"),
    );
  });
});
