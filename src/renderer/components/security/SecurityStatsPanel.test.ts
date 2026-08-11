/**
 * @file SecurityStatsPanel.test.ts
 * @description Component-level tests for the Security dashboard tab. Renders
 * the real component via `react-dom/client` + `act` (no
 * `@testing-library/react` is installed) — same technique as
 * `SettingSecurity.test.ts` / `AutocompletePanel.test.ts`.
 *
 * Two behaviours carry the weight: a rejected bridge call must land in the
 * error state rather than being drawn as a wall of zeros (which reads as "no
 * guard ever fired"), and changing the shared range pill must refetch, because
 * a range the panel ignores would show 7-day numbers under a 30-day label.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SECURITY_STATS } from "~/features/guards/shared/securityStats";
import { SecurityStatsPanel } from "./SecurityStatsPanel";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { AnalyticsRange } from "../../analytics/shared";
import type { SecurityStats } from "~/features/guards/shared/securityStats";
import type { Locale } from "~/features/i18n/shared/registry";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const stats = (overrides: Partial<SecurityStats> = {}): SecurityStats => ({
  ...EMPTY_SECURITY_STATS,
  ...overrides,
});

describe("SecurityStatsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let getSecurityStats: ReturnType<typeof vi.fn>;

  const render = async (
    reply: ReturnType<typeof vi.fn>,
    range: AnalyticsRange = "all",
  ): Promise<void> => {
    getSecurityStats = reply;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getSecurityStats,
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn((_callback: (locale: Locale) => void) => vi.fn()),
      },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, null, createElement(SecurityStatsPanel, { range })));
    });
    await waitForUi();
    await waitForUi();
  };

  const rerenderWithRange = async (range: AnalyticsRange): Promise<void> => {
    await act(async () => {
      root.render(createElement(I18nProvider, null, createElement(SecurityStatsPanel, { range })));
    });
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
    vi.restoreAllMocks();
  });

  it("renders both sections and the counts once stats resolve", async () => {
    await render(
      vi.fn().mockResolvedValue(
        stats({
          secretMasked: 2,
          maskedValues: 3,
          maskedPlaceholders: 2,
          blockedByApp: 1,
          eventCount: 3,
          lastEventAt: "2026-08-10T09:00:00.000Z",
        }),
      ),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Secret guard");
    expect(text).toContain("Selection guards");
    expect(text).toContain("Requests masked");
    expect(text).toContain("3 values, 2 placeholders");
    // Reads from the local logs, and says so — clearing Logs resets the counts.
    expect(text).toContain("Logs");
  });

  it("says nothing has fired instead of leaving an empty page", async () => {
    await render(vi.fn().mockResolvedValue(stats()));

    expect(container.textContent).toContain("No guard has fired in this range");
  });

  /** Zeros would read as "no guard ever fired" — a different claim entirely. */
  it("shows the error state when the bridge rejects, never zeros", async () => {
    await render(vi.fn().mockRejectedValue(new Error("Malformed security stats reply")));

    const text = container.textContent ?? "";
    expect(text).toContain("Couldn't read guard activity.");
    expect(text).not.toContain("Requests masked");
  });

  it("refetches with the new range when the shared pills change", async () => {
    await render(vi.fn().mockResolvedValue(stats({ blockedByApp: 1, eventCount: 1 })), "all");

    expect(getSecurityStats.mock.calls).toEqual([["all"]]);

    await rerenderWithRange("7d");

    expect(getSecurityStats.mock.calls).toEqual([["all"], ["7d"]]);
  });

  it("names a detected rule from the catalog rather than its raw id", async () => {
    await render(
      vi.fn().mockResolvedValue(
        stats({ secretMasked: 1, eventCount: 1, ruleCounts: { "aws-access-key-id": 1 } }),
      ),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("AWS access key ID");
    expect(text).not.toContain("aws-access-key-id");
  });
});
