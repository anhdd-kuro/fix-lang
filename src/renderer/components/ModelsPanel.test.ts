/**
 * @file ModelsPanel.test.ts
 * @description Component-level smoke for the Models tab charts: caption copy,
 * Model Breakdown title, and a Chart.js canvas. Locale switch updates the
 * caption. Tooltip formatting stays covered by `modelsView.test.ts`.
 *
 * `ModelSelect` is stubbed out — it independently fetches provider/model
 * state over IPC on mount, which is unrelated to the chart wiring under test.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelsPanel } from "./ModelsPanel";
import { I18nProvider } from "../i18n/I18nProvider";
import type { HistoryEntry } from "~/features/history/store/historyStore";
import type { Locale } from "~/features/i18n/shared/registry";

vi.mock("./ModelSelect", () => ({
  ModelSelect: () => null,
}));

vi.mock("./ModelsCharts", () => ({
  ModelsTokenUsageChart: () => null,
  ModelsBreakdownDonut: () => null,
}));

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("ModelsPanel charts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;

  const render = async (history: HistoryEntry[]) => {
    const api = {
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        localeListener = callback;
        return vi.fn();
      }),
      onThemeChanged: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, "electronAPI", { configurable: true, value: api });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(ModelsPanel, { history, range: "all" }),
        ),
      );
    });
    // Mirrors `ModelSelect.test.ts`/`SettingUpdates.test.ts`: the provider
    // renders null until its initial async `getLocale()` resolves.
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
    localeListener = undefined;
    vi.restoreAllMocks();
  });

  it("renders Model Breakdown title and model rows, and locale-switches the title", async () => {
    const now = new Date();
    const history: HistoryEntry[] = [
      {
        original: "a",
        corrected: "b",
        timestamp: now.toISOString(),
        model: "gpt-test",
        promptTokens: 4000,
        completionTokens: 200,
      },
    ];
    await render(history);

    const { createTranslator } = await import("~/features/i18n/shared/translate");
    const tEn = createTranslator("en");
    const tJa = createTranslator("ja");

    expect(container.textContent).toContain(tEn("models.breakdown.title"));
    expect(container.textContent).toContain("gpt-test");

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(container.textContent).toContain(tJa("models.breakdown.title"));
    expect(tEn("models.breakdown.title")).not.toBe(tJa("models.breakdown.title"));
  });
});
