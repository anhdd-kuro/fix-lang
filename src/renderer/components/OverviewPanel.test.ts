/**
 * @file OverviewPanel.test.ts
 * @description Component-level regression test for Bug A (the token-activity
 * calendar's tooltip formatter): `OverviewPanel.tsx` used to pass an identity
 * `DayKeyFormatter` (`{ date: (dayKey) => dayKey }`) into `tooltipMessageForCell`
 * instead of one built from the locale-aware `formatDate`, so every heatmap
 * cell's tooltip/aria-label showed the raw dense day key ("YYYY-MM-DD")
 * verbatim in both languages. This renders the real component (via
 * `react-dom/client` + `act`, the technique already used in
 * `SettingUpdates.test.ts`/`ModelSelect.test.ts` — no `@testing-library/react`
 * is installed) and asserts the actual DOM `title` attributes are
 * locale-formatted, differ between en/ja, and never contain a raw ISO day key.
 *
 * `PresetWeightChart` is stubbed out — it renders Chart.js canvases (jsdom has
 * no canvas 2D context) and is not part of this bug; only the token-activity
 * calendar wiring below it is under test here.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormatters } from "~/features/i18n/shared/format";
import { OverviewPanel } from "./OverviewPanel";
import { dayKeyDateFormatter } from "./tokenActivityView";
import { I18nProvider } from "../i18n/I18nProvider";
import type { HistoryEntry } from "~/features/history/store/historyStore";
import type { Locale } from "~/features/i18n/shared/registry";

vi.mock("./PresetWeightChart", () => ({
  PresetWeightChart: () => null,
}));

class StubResizeObserver {
  // `useElementWidth` only needs a `ResizeObserver` that doesn't throw — this
  // test asserts on rendered tooltip text, not on resize-driven cell sizing.
  observe(): void {
    // no-op stub
  }
  unobserve(): void {
    // no-op stub
  }
  disconnect(): void {
    // no-op stub
  }
}

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const pad2 = (n: number): string => `${n}`.padStart(2, "0");
const localDayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const RAW_ISO_DAY_KEY = /\d{4}-\d{2}-\d{2}/;

describe("OverviewPanel token-activity calendar tooltip", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  const originalResizeObserver = globalThis.ResizeObserver;

  const render = async (history: HistoryEntry[]) => {
    const api = {
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        localeListener = callback;
        return vi.fn();
      }),
    };
    Object.defineProperty(window, "electronAPI", { configurable: true, value: api });
    // `useElementWidth` constructs a real `ResizeObserver`, which jsdom does
    // not provide.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      StubResizeObserver;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(OverviewPanel, { history, range: "all" }),
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
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      originalResizeObserver;
    vi.restoreAllMocks();
  });

  it("renders locale-formatted tooltips for the calendar, differing between en and ja, never the raw day key", async () => {
    const now = new Date();
    const history: HistoryEntry[] = [
      { original: "a", corrected: "b", timestamp: now.toISOString(), promptTokens: 100, completionTokens: 50 },
    ];
    await render(history);

    const titlesOf = (): string[] =>
      [...container.querySelectorAll("[title]")].map((el) => el.getAttribute("title") ?? "");

    // Regression guard for Bug A: no tooltip anywhere leaks a raw ISO day key.
    expect(titlesOf().some((title) => RAW_ISO_DAY_KEY.test(title))).toBe(false);

    const todayKey = localDayKey(now);
    const enLabel = dayKeyDateFormatter(createFormatters("en").formatDate).date(todayKey);
    expect(titlesOf().some((title) => title.includes(enLabel))).toBe(true);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    const jaLabel = dayKeyDateFormatter(createFormatters("ja").formatDate).date(todayKey);
    expect(enLabel).not.toBe(jaLabel);
    expect(titlesOf().some((title) => title.includes(jaLabel))).toBe(true);
    expect(titlesOf().some((title) => RAW_ISO_DAY_KEY.test(title))).toBe(false);
  });
});
