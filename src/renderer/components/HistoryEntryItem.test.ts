/**
 * @file HistoryEntryItem.test.ts
 * @description Regression test for the hardcoded `"MM/dd HH:mm"` date-fns
 * pattern in `HistoryEntryItem.tsx`: passing `{ locale: dateFnsLocale }` only
 * localized month/day *names* — the literal `"MM/dd HH:mm"` field order and
 * separators stayed fixed regardless of locale. The fix routes the timestamp
 * through the shared `formatDateTime` formatter (`~/shared/i18n/format.ts`),
 * which resolves field order/separators/12h-vs-24h convention per locale via
 * `Intl.DateTimeFormat`.
 *
 * `entry.timestamp` is a full ISO instant (`new Date().toISOString()` at
 * write time — see `historyRepo.ts`/`historyRepo.test.ts`), not a
 * UTC-midnight day-bucket key, so there is no local/UTC boundary hazard here.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders the real component directly via
 * `react-dom/client` + `act`, following `SettingUpdates.test.ts` /
 * `ModelSelect.test.ts`. Expected text is derived from the real
 * `createFormatters` kernel — never hand-formatted — so a formatter change
 * can't silently break this file, and an English-fallback regression still
 * fails a test that asserts the JA-formatted string.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormatters } from "~/shared/i18n/format";
import HistoryEntryItem from "./HistoryEntryItem";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "~/shared/i18n/registry";
import type { HistoryEntry } from "~/stores/historyStore";

const fEn = createFormatters("en");
const fJa = createFormatters("ja");

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  original: "hello world",
  corrected: "Hello, world!",
  timestamp: "2026-07-25T14:30:00.000Z",
  ...overrides,
});

describe("HistoryEntryItem", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;

  const render = async (entry: HistoryEntry) => {
    const api = {
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        localeListener = callback;
        return vi.fn();
      }),
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
          createElement(HistoryEntryItem, {
            entry,
            onSelect: vi.fn(),
            onDelete: vi.fn(),
          }),
        ),
      );
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves
    // (mirrors `SettingUpdates.test.ts`).
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

  it("shows the timestamp through the locale-aware formatter, matching the real formatter's EN output", async () => {
    const entry = makeEntry();
    await render(entry);

    expect(container.textContent).toContain(fEn.formatDateTime(entry.timestamp));
  });

  it("re-renders the timestamp in Japanese's own field order/convention after a locale switch, differing from EN", async () => {
    const entry = makeEntry();
    await render(entry);

    const enExpected = fEn.formatDateTime(entry.timestamp);
    expect(container.textContent).toContain(enExpected);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    const jaExpected = fJa.formatDateTime(entry.timestamp);
    expect(container.textContent).toContain(jaExpected);
    // Prove the locale actually changed and this isn't an English fallback —
    // the exact regression this file guards: the old "MM/dd HH:mm" literal
    // pattern rendered byte-identical output regardless of locale.
    expect(jaExpected).not.toBe(enExpected);
  });
});
