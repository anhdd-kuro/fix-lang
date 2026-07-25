/**
 * @file ModelsPanel.test.ts
 * @description Component-level regression test for Bug B (the model usage
 * bar tooltip): `ModelsPanel.tsx` used to call
 * `barTooltipMessage(b, b.date)` — passing the bar's raw dense day key
 * ("YYYY-MM-DD") where `barTooltipMessage` expects an already-formatted
 * `dateLabel` string — so every bar's tooltip showed the raw day key verbatim
 * in both languages. This renders the real component (via `react-dom/client`
 * + `act`, the technique already used in `SettingUpdates.test.ts` /
 * `ModelSelect.test.ts` — no `@testing-library/react` is installed) and
 * asserts the actual DOM `title` attributes are locale-formatted, differ
 * between en/ja, and never contain a raw ISO day key.
 *
 * `ModelSelect` is stubbed out — it independently fetches provider/model
 * state over IPC on mount, which is unrelated to this bug; only the
 * token-volume bar tooltip wiring is under test here.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormatters } from "~/shared/i18n/format";
import { ModelsPanel } from "./ModelsPanel";
import { barDateLabel } from "./modelsView";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "~/shared/i18n/registry";
import type { HistoryEntry } from "~/stores/historyStore";

vi.mock("./ModelSelect", () => ({
  ModelSelect: () => null,
}));

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const pad2 = (n: number): string => `${n}`.padStart(2, "0");
const localDayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const RAW_ISO_DAY_KEY = /\d{4}-\d{2}-\d{2}/;

describe("ModelsPanel token-volume bar tooltip", () => {
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

  it("renders a locale-formatted bar tooltip, differing between en and ja, never the raw day key", async () => {
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

    const titlesOf = (): string[] =>
      [...container.querySelectorAll("[title]")].map((el) => el.getAttribute("title") ?? "");

    // Regression guard for Bug B: no bar tooltip leaks a raw ISO day key.
    expect(titlesOf().some((title) => RAW_ISO_DAY_KEY.test(title))).toBe(false);

    const todayKey = localDayKey(now);
    const enLabel = barDateLabel(createFormatters("en").formatDate, todayKey);
    expect(titlesOf().some((title) => title.includes(enLabel))).toBe(true);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    const jaLabel = barDateLabel(createFormatters("ja").formatDate, todayKey);
    expect(enLabel).not.toBe(jaLabel);
    expect(titlesOf().some((title) => title.includes(jaLabel))).toBe(true);
    expect(titlesOf().some((title) => RAW_ISO_DAY_KEY.test(title))).toBe(false);
  });
});
