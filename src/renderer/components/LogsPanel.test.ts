/**
 * @file LogsPanel.test.ts
 * @description Regression test for the Finding-3 fix: `loadInitialPage`'s
 * dependency array intentionally omits `t` (a locale switch must not
 * re-fetch logs), but the review's stated conclusion that this makes the
 * stale error banner "unreachable" was wrong — if `queryLogs` rejects at
 * mount in English, the banner stayed English after switching to Japanese.
 * It doesn't anymore: `status` now holds a locale-free `Message` descriptor,
 * resolved via `tm()` at render, instead of pre-resolved prose.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders the real component directly via
 * `react-dom/client` + `act` — the same technique already used in
 * `SettingUpdates.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogsPanel } from "./LogsPanel";
import { utcOffsetLabel } from "./logsView";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "~/shared/i18n/registry";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("LogsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let queryLogs: ReturnType<typeof vi.fn>;

  const render = async (
    queryLogsImpl: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockRejectedValue(new Error("disk read failed")),
  ) => {
    queryLogs = queryLogsImpl;
    const api = {
      queryLogs,
      onLogAppend: vi.fn().mockReturnValue(vi.fn()),
      clearLogs: vi.fn().mockResolvedValue({ success: true }),
      copyLogs: vi.fn().mockResolvedValue({ success: true, count: 0 }),
      exportLogs: vi.fn().mockResolvedValue({ success: true, canceled: false }),
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
    // jsdom implements no `Element#scrollTo`, which the auto-scroll effect
    // calls as soon as a page of entries lands.
    Element.prototype.scrollTo = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, null, createElement(LogsPanel)));
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves,
    // and `loadInitialPage`'s rejection needs a further tick to land in state
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
    Reflect.deleteProperty(Element.prototype, "scrollTo");
    vi.restoreAllMocks();
  });

  it("keeps a stale load-failure banner correctly translated after a locale switch, without refetching", async () => {
    await render();

    const status = () =>
      container.querySelector('[role="status"][aria-live="polite"]');
    expect(status()?.textContent).toBe("Failed to load logs: disk read failed");
    expect(queryLogs).toHaveBeenCalledTimes(1);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(status()?.textContent).toBe(
      "ログの読み込みに失敗しました: disk read failed",
    );
    // Switching locale must NOT re-run `loadInitialPage` — that is the whole
    // point of keeping `t` out of its dependency array.
    expect(queryLogs).toHaveBeenCalledTimes(1);
  });

  it("states the timezone once in the footer instead of on every row", async () => {
    const timestamp = "2026-07-19T00:00:00.000Z";
    await render(
      vi.fn().mockResolvedValue({
        entries: [
          {
            id: "1",
            timestamp,
            level: "info",
            scope: "correction",
            message: "Correction completed",
          },
        ],
        nextCursor: timestamp,
        hasMore: false,
      }),
    );

    const offset = utcOffsetLabel(new Date(timestamp).getTimezoneOffset());
    const footer = container.querySelector('[role="status"]')?.parentElement;
    expect(footer?.textContent).toContain(offset);
    expect(footer?.textContent).toContain("1 entry");
    // The rows themselves are virtualized and never mount in jsdom (the scroll
    // element has no height here), so the "no per-row offset" half of this is
    // covered by the format string in `LogsPanel.tsx` plus `timeZoneLabel`
    // tests in `logsView.test.ts`.
  });

  it("queries only the checked levels and treats an empty selection as all", async () => {
    await render(
      vi.fn().mockResolvedValue({
        entries: [],
        nextCursor: null,
        hasMore: false,
      }),
    );

    expect(queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ levels: [] }),
    );

    // Open the level dropdown and check "Warn".
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Log level"]',
    );
    expect(trigger?.textContent).toContain("All levels");
    await act(async () => {
      trigger?.click();
    });
    const warn = [
      ...container.querySelectorAll<HTMLInputElement>('[role="group"] input'),
    ][2];
    await act(async () => {
      warn?.click();
    });
    await waitForUi();

    expect(queryLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ levels: ["warn"] }),
    );
    expect(trigger?.textContent).toContain("Warn");
  });
});
