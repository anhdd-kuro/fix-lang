/**
 * @file HistoryEntryItem.test.ts
 * @description Regression test for the hardcoded `"MM/dd HH:mm"` date-fns
 * pattern in `HistoryEntryItem.tsx`: passing `{ locale: dateFnsLocale }` only
 * localized month/day *names* — the literal `"MM/dd HH:mm"` field order and
 * separators stayed fixed regardless of locale. The fix routes the timestamp
 * through the shared `formatDateTime` formatter (`~/features/i18n/shared/format.ts`),
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
import { createFormatters } from "~/features/i18n/shared/format";
import HistoryEntryItem from "./HistoryEntryItem";
import { I18nProvider } from "../i18n/I18nProvider";
import type { HistoryEntry } from "~/features/history/store/historyStore";
import type { Locale } from "~/features/i18n/shared/registry";

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

  it("re-renders the timestamp after a locale switch using the same YYYY-MM-DD HH:mm format", async () => {
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
    expect(jaExpected).toBe(enExpected);
  });

  it("truncates the preset badge instead of wrapping it onto a second line", async () => {
    const entry = makeEntry({ presetName: "Context-Aware Structured Text" });
    await render(entry);

    const badge = container.querySelector<HTMLElement>(
      `span[title="${entry.presetName}"]`,
    );

    expect(badge?.textContent).toBe(entry.presetName);
    // `truncate` = overflow-hidden + text-ellipsis + whitespace-nowrap, so a
    // long preset name can never make one row taller than its neighbours.
    expect(badge?.className).toContain("truncate");
  });

  it("appends no literal ellipsis to a preview that already fits", async () => {
    const entry = makeEntry({ original: "short" });
    await render(entry);

    const preview = container.querySelector<HTMLElement>(
      `p[title="${entry.original}"]`,
    );

    expect(preview?.textContent).toBe("short");
  });

  /**
   * `truncate`/`line-clamp` silently do nothing on a flex child whose ancestors
   * keep the default `min-width: auto`: the child refuses to shrink below its
   * longest word, the row grows past the list, and `overflow-y-auto` on the
   * list (whose `overflow-x: visible` then computes to `auto`) answers with a
   * horizontal scrollbar. Every ancestor on the path from a truncating element
   * up to the row root must therefore carry `min-w-0` — including the ones
   * whose only flex marker is `flex-1`, which is a flex ITEM, not a container,
   * and is exactly the ancestor an earlier version of this guard missed.
   */
  it("gives every ancestor of a truncating element the min-w-0 that makes truncation work", async () => {
    const entry = makeEntry({
      original: "a".repeat(400),
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      presetName: "Context-Aware Structured Text",
    });
    await render(entry);

    const truncating = [...container.querySelectorAll<HTMLElement>(".truncate")];
    expect(truncating.length).toBeGreaterThanOrEqual(3);

    for (const element of truncating) {
      for (
        let ancestor = element.parentElement;
        ancestor && ancestor !== container;
        ancestor = ancestor.parentElement
      ) {
        expect([...ancestor.classList]).toContain("min-w-0");
      }
    }
  });

  it("places the session-details control before the history title", async () => {
    const entry = makeEntry({
      sessionJson: JSON.stringify({
        messages: [],
        model: "gpt-4.1-mini",
        provider: "openai",
        responses: [],
        promptTokens: 1,
        completionTokens: 1,
      }),
    });
    await render(entry);

    const control = container.querySelector(
      'button[aria-label="View session details"]',
    );
    const title = container.querySelector(`p[title="${entry.original}"]`);

    expect(control).not.toBeNull();
    expect(title?.parentElement?.firstElementChild).toBe(control?.parentElement);
  });
});
