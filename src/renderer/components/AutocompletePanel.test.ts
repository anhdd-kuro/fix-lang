/**
 * @file AutocompletePanel.test.ts
 * @description Component-level tests for the Autocomplete dashboard tab.
 * Renders the real component via `react-dom/client` + `act` (no
 * `@testing-library/react` is installed) — the same technique used in
 * `LogsPanel.test.ts`/`ModelsPanel.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutocompletePanel } from "./AutocompletePanel";
import { I18nProvider } from "../i18n/I18nProvider";
import type { AutocompleteUsageSnapshot } from "~/features/autocomplete/shared/autocompleteWire";
import type { Locale } from "~/features/i18n/shared/registry";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const emptySnapshot = (): AutocompleteUsageSnapshot => ({
  today: {
    date: "2026-07-31",
    requests: 0,
    responses: 0,
    tokenlessResponses: 0,
    unpricedResponses: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  },
  month: {
    date: "2026-07",
    requests: 0,
    responses: 0,
    tokenlessResponses: 0,
    unpricedResponses: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  },
  days: [],
  dailyCap: 1500,
});

describe("AutocompletePanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let getAutocompleteUsage: ReturnType<typeof vi.fn>;

  const render = async (
    getAutocompleteUsageImpl: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(emptySnapshot()),
  ) => {
    getAutocompleteUsage = getAutocompleteUsageImpl;
    const api = {
      getAutocompleteUsage,
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
      root.render(createElement(I18nProvider, null, createElement(AutocompletePanel)));
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves,
    // and the panel's own `getAutocompleteUsage()` needs a further tick.
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

  it("renders the empty state without throwing when nothing has been recorded", async () => {
    await expect(render()).resolves.not.toThrow();
    expect(container.textContent).toContain("No autocomplete requests recorded yet.");
    // Zero-request/zero-response rollups are a real zero, not N/A.
    expect(container.textContent).not.toContain("N/A");
  });

  it("renders an error message instead of throwing when the IPC call rejects", async () => {
    await expect(
      render(vi.fn().mockRejectedValue(new Error("ipc failed"))),
    ).resolves.not.toThrow();
    expect(container.textContent).toContain("Could not load autocomplete usage.");
  });

  it("reports cost as N/A — never a fabricated $0.00 — for a direct-OpenAI-style day with known tokens but no knowable price", async () => {
    const snapshot: AutocompleteUsageSnapshot = {
      today: {
        date: "2026-07-31",
        requests: 42,
        responses: 42,
        tokenlessResponses: 0,
        unpricedResponses: 42,
        promptTokens: 800,
        completionTokens: 200,
        estimatedCostUsd: 0,
      },
      month: {
        date: "2026-07",
        requests: 300,
        responses: 300,
        tokenlessResponses: 0,
        unpricedResponses: 0,
        promptTokens: 4000,
        completionTokens: 900,
        estimatedCostUsd: 0.15,
      },
      days: [
        {
          date: "2026-07-31",
          requests: 42,
          responses: 42,
          tokenlessResponses: 0,
          unpricedResponses: 42,
          promptTokens: 800,
          completionTokens: 200,
          estimatedCostUsd: 0,
        },
      ],
      dailyCap: 1500,
    };
    await render(vi.fn().mockResolvedValue(snapshot));

    expect(getAutocompleteUsage).toHaveBeenCalledTimes(1);
    // Today has real, fully-known tokens but no knowable price — N/A, never
    // the fabricated "$0.00" the deleted heuristic used to produce.
    expect(container.textContent).toContain("N/A");
    expect(container.textContent).not.toContain("$0.00");
    expect(container.textContent).toContain("1,000");
    // Month is fully priced — its cost renders as a real amount.
    expect(container.textContent).toContain("$0.15");
    expect(container.textContent).toContain("42");
  });

  it("reports tokens as N/A — never a fabricated 0 — for a local-provider-style day with a known $0 cost but no reported tokens", async () => {
    const snapshot: AutocompleteUsageSnapshot = {
      today: {
        date: "2026-07-31",
        requests: 7,
        responses: 7,
        tokenlessResponses: 7,
        unpricedResponses: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
      },
      month: {
        date: "2026-07",
        requests: 7,
        responses: 7,
        tokenlessResponses: 7,
        unpricedResponses: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
      },
      days: [],
      dailyCap: 1500,
    };
    await render(vi.fn().mockResolvedValue(snapshot));

    // Ollama/LM Studio never report token counts — every response is
    // "tokenless", so the token axis must read N/A, never the fabricated "0"
    // a `value ?? 0` fallback would produce. Cost is a SEPARATE, honestly
    // known $0 for a local provider and must still render as a real amount.
    expect(container.textContent).toContain("N/A");
    expect(container.textContent).toContain("$0.00");
  });

  it("reports a mixed-coverage day as the known amount PLUS its coverage, not the knowable half alone", async () => {
    const mixedDay = {
      date: "2026-07-31",
      requests: 3,
      responses: 3,
      tokenlessResponses: 1,
      unpricedResponses: 1,
      promptTokens: 200,
      completionTokens: 40,
      estimatedCostUsd: 0.03,
    };
    const snapshot: AutocompleteUsageSnapshot = {
      today: mixedDay,
      month: mixedDay,
      days: [mixedDay],
      dailyCap: 1500,
    };
    await render(vi.fn().mockResolvedValue(snapshot));

    expect(container.textContent).toContain("$0.03");
    expect(container.textContent).toContain("240");
    // The coverage sub-line must appear as its own distinctive phrase — not
    // merely "2" and "3" as loose substrings, which the rendered amount
    // ("$0.03") and token count ("240") already satisfy on their own even if
    // `formatAutocompleteCoverage` were never called.
    expect(container.textContent).toContain("2 of 3 known");
  });

  it("locale-switches the section titles", async () => {
    await render();
    expect(container.textContent).toContain("Today");

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(container.textContent).toContain("本日");
  });
});
